fn main() {
    let triple = std::env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=BARA_TARGET_TRIPLE={triple}");
}
