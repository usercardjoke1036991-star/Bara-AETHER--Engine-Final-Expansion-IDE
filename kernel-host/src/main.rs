//! Bucle del sidecar. Una petición JSON por línea en stdin, una respuesta
//! por línea en stdout. Lo que no es el protocolo va a stderr.

#![forbid(unsafe_code)]

use std::io::{self, BufRead, Write};

use bara_kernel_host::dispatch::{dispatch_line, World};

fn main() {
    let stdin = io::stdin();
    let mut world = World::new();
    let mut line = String::new();
    let mut input = stdin.lock();
    loop {
        line.clear();
        match input.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if line.len() > bara_kernel_host::dispatch::MAX_REQUEST {
            let _ = writeln!(
                io::stdout(),
                "{{\"id\":0,\"ok\":false,\"err\":\"la petición supera el tope\"}}"
            );
            let _ = io::stdout().flush();
            continue;
        }
        let response = dispatch_line(&mut world, line.trim());
        println!("{response}");
        let _ = io::stdout().flush();
    }
}
