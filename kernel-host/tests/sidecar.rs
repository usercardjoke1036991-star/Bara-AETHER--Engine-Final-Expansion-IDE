//! El pánico, el bucle y la respuesta enorme viven en el hijo. Este proceso
//! sigue y la petición siguiente vuelve a tener kernel.

use std::time::Duration;

use bara_kernel_host::KernelHost;
use serde_json::json;

fn host() -> KernelHost {
    host_with(Duration::from_millis(400))
}

fn host_with(timeout: Duration) -> KernelHost {
    KernelHost::for_tests(
        host_exe(),
        timeout,
        16 * 1024 * 1024,
        Duration::from_millis(50),
    )
}

/// `cargo test` de este workspace no inyecta `CARGO_BIN_EXE_*`. El binario
/// queda junto al de las pruebas, un nivel por encima de `deps/`.
fn host_exe() -> std::path::PathBuf {
    if let Some(raw) = option_env!("CARGO_BIN_EXE_bara_kernel_host") {
        let path = std::path::PathBuf::from(raw);
        if path.is_file() {
            return path;
        }
    }
    let mut dir = std::env::current_exe().expect("el test tiene ruta");
    dir.pop();
    dir.pop();
    dir.push(if cfg!(windows) {
        "bara-kernel-host.exe"
    } else {
        "bara-kernel-host"
    });
    dir
}

#[test]
fn un_panico_del_sidecar_no_tumba_al_supervisor_y_la_siguiente_peticion_funciona() {
    let host = host();
    let failure = host.call("fault-panic", json!({})).expect_err("pánico");
    assert!(failure.contains("se cayó"), "{failure}");
    let again = host
        .call("analyze", json!({ "source": "manifestar\n" }))
        .expect("el IDE sigue y el hijo volvió");
    assert!(again.get("tokens").is_some() || again.get("summary").is_some() || again.is_object());
    let direct = serde_json::to_value(bara_ide::analyze("manifestar\n")).expect("modelo");
    assert_eq!(again, direct);
}

#[test]
fn un_bucle_se_corta_por_plazo_y_el_arbol_muere() {
    let host = host();
    let first = host.pid();
    let started = std::time::Instant::now();
    let failure = host.call("fault-loop", json!({})).expect_err("bucle");
    assert!(failure.contains("plazo"), "{failure}");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "el plazo no cortó"
    );
    assert_ne!(host.pid(), first);
    host.call("catalogue", json!({}))
        .expect("después del corte hay kernel");
}

#[test]
fn una_respuesta_enorme_es_un_error_controlado() {
    let host = host_with(Duration::from_secs(8));
    let failure = host.call("fault-huge", json!({})).expect_err("tope");
    assert!(failure.contains("tope"), "{failure}");
    host.call("belnap_lattice", json!({})).expect("sigue vivo");
}

#[test]
fn los_programas_de_ejemplo_coinciden_con_el_proceso() {
    let host = host();
    let samples = [
        include_str!("../../samples/genesis.bara"),
        "",
        "manifestar guarda\n",
        "sintetizar raiz desconocida\n",
    ];
    for source in samples {
        let direct = serde_json::to_value(bara_ide::analyze(source)).expect("en proceso");
        let remote = host
            .call("analyze", json!({ "source": source }))
            .expect("sidecar");
        assert_eq!(remote, direct);
        let direct_auto = serde_json::to_value(bara_ide::autopoiesis(source)).expect("auto");
        let remote_auto = host
            .call("autopoiesis", json!({ "source": source }))
            .expect("auto sidecar");
        assert_eq!(remote_auto, direct_auto);
    }
}
