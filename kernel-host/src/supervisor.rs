//! Supervisor del sidecar. Un plazo, un tope de respuesta y el corte del
//! árbol de procesos. El mismo corte lo usan las recetas del IDE.

#![forbid(unsafe_code)]

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Estado que pinta el IDE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KernelStatus {
    Activo,
    Reiniciando,
    Caido,
}

impl KernelStatus {
    pub fn label(self) -> &'static str {
        match self {
            KernelStatus::Activo => "activo",
            KernelStatus::Reiniciando => "reiniciando",
            KernelStatus::Caido => "caído",
        }
    }
}

#[derive(Clone)]
struct Policy {
    timeout: Duration,
    max_response: usize,
    crash_limit: u32,
    backoff: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(10),
            max_response: 16 * 1024 * 1024,
            crash_limit: 3,
            backoff: Duration::from_secs(2),
        }
    }
}

struct Slot {
    exe: PathBuf,
    policy: Policy,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<std::process::ChildStdout>>,
    next_id: u64,
    streak: u32,
    status: KernelStatus,
}

type StatusListener = Arc<dyn Fn(&str) + Send + Sync>;

/// Proceso hijo del kernel. Las llamadas se serializan: el protocolo es una
/// sola tubería.
#[derive(Clone)]
pub struct KernelHost {
    slot: Arc<Mutex<Slot>>,
    listener: Arc<Mutex<Option<StatusListener>>>,
}

impl KernelHost {
    /// Busca el binario empaquetado y lo deja listo. Si no está, el estado
    /// queda en `caído` y la ventana sigue abierta.
    pub fn boot() -> Self {
        let host =
            Self::detached(bundled_host().unwrap_or_else(|_| PathBuf::from("bara-kernel-host")));
        let _ = host.ensure();
        host
    }

    /// Supervisor de pruebas: binario, plazo y tope explícitos.
    pub fn for_tests(
        exe: PathBuf,
        timeout: Duration,
        max_response: usize,
        backoff: Duration,
    ) -> Self {
        let host = Self::with_policy(
            exe,
            Policy {
                timeout,
                max_response,
                crash_limit: 3,
                backoff,
            },
        );
        let _ = host.ensure();
        host
    }

    fn detached(exe: PathBuf) -> Self {
        Self::with_policy(exe, Policy::default())
    }

    fn with_policy(exe: PathBuf, policy: Policy) -> Self {
        Self {
            slot: Arc::new(Mutex::new(Slot {
                exe,
                policy,
                child: None,
                stdin: None,
                stdout: None,
                next_id: 1,
                streak: 0,
                status: KernelStatus::Reiniciando,
            })),
            listener: Arc::new(Mutex::new(None)),
        }
    }

    pub fn listen(&self, listener: impl Fn(&str) + Send + Sync + 'static) {
        if let Ok(mut guard) = self.listener.lock() {
            *guard = Some(Arc::new(listener));
        }
    }

    pub fn status(&self) -> KernelStatus {
        self.slot
            .lock()
            .map(|guard| guard.status)
            .unwrap_or(KernelStatus::Caido)
    }

    pub fn pid(&self) -> Option<u32> {
        self.slot
            .lock()
            .ok()
            .and_then(|guard| guard.child.as_ref().map(Child::id))
    }

    /// Envía una operación y espera su línea. El secreto no viaja por aquí.
    pub fn call(&self, op: &str, args: Value) -> Result<Value, String> {
        let mut guard = self
            .slot
            .lock()
            .map_err(|_| "el supervisor del kernel no está disponible".to_string())?;
        if guard.child.is_none() {
            self.relaunch(&mut guard)?;
        }
        let id = guard.next_id;
        guard.next_id = guard.next_id.wrapping_add(1).max(1);
        let line = json!({ "id": id, "op": op, "args": args }).to_string();
        let timeout = guard.policy.timeout;
        let cap = guard.policy.max_response;
        match roundtrip(&mut guard, &line, timeout, cap) {
            Ok(value) => {
                guard.streak = 0;
                self.publish(&mut guard, KernelStatus::Activo);
                Ok(value)
            }
            Err(TripError::Rejected(error)) => {
                guard.streak = 0;
                self.publish(&mut guard, KernelStatus::Activo);
                Err(error)
            }
            Err(TripError::Dead(error)) => {
                guard.streak = guard.streak.saturating_add(1);
                if let Some(child) = guard.child.as_mut() {
                    terminate_tree(child);
                }
                guard.child = None;
                guard.stdin = None;
                guard.stdout = None;
                self.publish(&mut guard, KernelStatus::Reiniciando);
                let _ = self.relaunch(&mut guard);
                Err(error)
            }
        }
    }

    fn relaunch(&self, guard: &mut Slot) -> Result<(), String> {
        if guard.streak >= guard.policy.crash_limit {
            let wait = guard.policy.backoff;
            self.publish(guard, KernelStatus::Reiniciando);
            thread::sleep(wait);
        }
        match spawn_child(&guard.exe) {
            Ok((child, stdin, stdout)) => {
                guard.child = Some(child);
                guard.stdin = Some(stdin);
                guard.stdout = Some(stdout);
                self.publish(guard, KernelStatus::Activo);
                Ok(())
            }
            Err(error) => {
                self.publish(guard, KernelStatus::Caido);
                Err(error)
            }
        }
    }

    fn ensure(&self) -> Result<(), String> {
        let mut guard = self
            .slot
            .lock()
            .map_err(|_| "el supervisor del kernel no está disponible".to_string())?;
        if guard.child.is_none() {
            self.relaunch(&mut guard)?;
        }
        Ok(())
    }

    fn publish(&self, guard: &mut Slot, status: KernelStatus) {
        guard.status = status;
        if let Ok(listener) = self.listener.lock() {
            if let Some(listener) = listener.as_ref() {
                listener(status.label());
            }
        }
    }
}

enum TripError {
    /// El hijo sigue vivo y rechazó la operación.
    Rejected(String),
    /// La tubería se rompió: hay que matar y relanzar.
    Dead(String),
}

fn roundtrip(
    guard: &mut Slot,
    line: &str,
    timeout: Duration,
    cap: usize,
) -> Result<Value, TripError> {
    let mut stdin = guard
        .stdin
        .take()
        .ok_or_else(|| TripError::Dead("el kernel no tiene entrada".to_string()))?;
    let mut stdout = guard
        .stdout
        .take()
        .ok_or_else(|| TripError::Dead("el kernel no tiene salida".to_string()))?;
    if writeln!(stdin, "{line}").is_err() || stdin.flush().is_err() {
        return Err(TripError::Dead(
            "el kernel se cayó; el IDE sigue en pie y lo está reiniciando".to_string(),
        ));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = thread::spawn(move || {
        let result = read_line_capped(&mut stdout, cap);
        let _ = tx.send((stdout, result));
    });
    let started = Instant::now();
    let received = loop {
        match rx.try_recv() {
            Ok(pair) => break Some(pair),
            Err(std::sync::mpsc::TryRecvError::Empty) if started.elapsed() >= timeout => {
                break None
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => thread::sleep(Duration::from_millis(20)),
            Err(std::sync::mpsc::TryRecvError::Disconnected) => break None,
        }
    };
    match received {
        Some((stdout, Ok(bytes))) => {
            guard.stdin = Some(stdin);
            guard.stdout = Some(stdout);
            let _ = worker.join();
            parse_response(guard, &bytes)
        }
        Some((_stdout, Err(ReadFail::TooBig))) => {
            let _ = worker.join();
            Err(TripError::Dead(
                "la respuesta del kernel supera el tope de 16 MB y se descartó".to_string(),
            ))
        }
        Some((_stdout, Err(ReadFail::Closed))) => {
            let _ = worker.join();
            Err(TripError::Dead(
                "el kernel se cayó; el IDE sigue en pie y lo está reiniciando".to_string(),
            ))
        }
        None => {
            if let Some(child) = guard.child.as_mut() {
                terminate_tree(child);
            }
            let _ = worker.join();
            Err(TripError::Dead(
                "el kernel superó el plazo y se detuvo; el IDE sigue en pie y lo está reiniciando"
                    .to_string(),
            ))
        }
    }
}

fn parse_response(guard: &Slot, bytes: &[u8]) -> Result<Value, TripError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        TripError::Dead("el kernel se cayó; el IDE sigue en pie y lo está reiniciando".to_string())
    })?;
    let value: Value = serde_json::from_str(text).map_err(|_| {
        TripError::Dead("el kernel se cayó; el IDE sigue en pie y lo está reiniciando".to_string())
    })?;
    let expected = guard.next_id.wrapping_sub(1);
    if value.get("id").and_then(Value::as_u64) != Some(expected) {
        return Err(TripError::Dead(
            "el kernel se cayó; el IDE sigue en pie y lo está reiniciando".to_string(),
        ));
    }
    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(value.get("data").cloned().unwrap_or(Value::Null));
    }
    Err(TripError::Rejected(
        value
            .get("err")
            .and_then(Value::as_str)
            .unwrap_or("el kernel rechazó la operación")
            .to_string(),
    ))
}

enum ReadFail {
    Closed,
    TooBig,
}

fn read_line_capped(reader: &mut impl BufRead, cap: usize) -> Result<Vec<u8>, ReadFail> {
    let mut out = Vec::new();
    loop {
        let (taken, done) = {
            let buf = match reader.fill_buf() {
                Ok([]) => return Err(ReadFail::Closed),
                Ok(buf) => buf,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(ReadFail::Closed),
            };
            match buf.iter().position(|byte| *byte == b'\n') {
                Some(pos) => {
                    if out.len().saturating_add(pos) > cap {
                        return Err(ReadFail::TooBig);
                    }
                    out.extend_from_slice(&buf[..pos]);
                    (pos + 1, true)
                }
                None => {
                    if out.len().saturating_add(buf.len()) > cap {
                        return Err(ReadFail::TooBig);
                    }
                    let width = buf.len();
                    out.extend_from_slice(buf);
                    (width, false)
                }
            }
        };
        reader.consume(taken);
        if done {
            if out.last() == Some(&b'\r') {
                out.pop();
            }
            return Ok(out);
        }
    }
}

fn spawn_child(
    exe: &Path,
) -> Result<(Child, ChildStdin, BufReader<std::process::ChildStdout>), String> {
    if !exe.is_file() {
        return Err("no se encontró el proceso del kernel".to_string());
    }
    let mut command = Command::new(exe);
    new_group(&mut command);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "no se pudo arrancar el proceso del kernel".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => eprint!("kernel: {line}"),
                }
            }
        });
    }
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "el kernel no abrió su entrada".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "el kernel no abrió su salida".to_string())?;
    Ok((child, stdin, BufReader::new(stdout)))
}

/// Mata el proceso y los que haya creado.
///
/// Windows: `taskkill /F /T /PID`. Unix: el hijo es líder de grupo y
/// `kill -KILL` apunta a ese grupo.
pub fn terminate_tree(child: &mut Child) {
    let pid = child.id();
    if cfg!(windows) {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// En Unix el hijo abre su propio grupo para poder matar a sus hijos con él.
pub fn new_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = command;
    }
}

/// Ruta del sidecar: junto al ejecutable, con o sin el sufijo de target triple
/// que Tauri pide al empaquetar.
pub fn bundled_host() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("BARA_KERNEL_HOST") {
        return Ok(PathBuf::from(path));
    }
    let triple = env!("BARA_TARGET_TRIPLE");
    let exe = std::env::current_exe().map_err(|_| "no se pudo ubicar el IDE".to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "no se pudo ubicar el IDE".to_string())?;
    let suffix = std::env::consts::EXE_SUFFIX;
    let names = [
        format!("bara-kernel-host{suffix}"),
        format!("bara-kernel-host-{triple}{suffix}"),
    ];
    for name in names {
        let path = dir.join(name);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("no se encontró el proceso del kernel".to_string())
}
