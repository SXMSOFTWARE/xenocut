fn main() {
    tauri_build::build();
    // The effect-plug-in host (OpenFX + frei0r) is linked into the desktop Linux binary and runs
    // as `xenocut --fxhost` in its own process.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        build_fxhost();
    }
}

fn build_fxhost() {
    let root = std::path::Path::new("fxhost");
    println!("cargo:rerun-if-changed=fxhost");
    let expat = root.join("vendor/expat");
    let defines = [
        ("XML_CONTEXT_BYTES", "1024"),
        ("XML_DTD", "1"),
        ("XML_NS", "1"),
        ("HAVE_MEMMOVE", "1"),
        ("XML_DEV_URANDOM", "1"),
        ("BYTEORDER", "1234"),
    ];
    let mut c = cc::Build::new();
    c.warnings(false);
    for (k, v) in defines {
        c.define(k, v);
    }
    for f in ["xmlparse.c", "xmlrole.c", "xmltok.c"] {
        c.file(expat.join(f));
    }
    c.include(&expat).compile("xcexpat");

    let mut cpp = cc::Build::new();
    cpp.cpp(true)
        .std("c++17")
        .warnings(false)
        .define("OFX_SUPPORTS_MULTITHREAD", None)
        .include(root.join("vendor/openfx/include"))
        .include(root.join("vendor/openfx/HostSupport/include"))
        .include(&expat);
    for entry in std::fs::read_dir(root.join("vendor/openfx/HostSupport/src")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "cpp") {
            cpp.file(path);
        }
    }
    for f in ["ofx_host.cpp", "frei0r_host.cpp", "fxhost.cpp"] {
        cpp.file(root.join(f));
    }
    cpp.compile("xcfxhost");
    println!("cargo:rustc-link-lib=dl");
    println!("cargo:rustc-link-lib=pthread");
}
