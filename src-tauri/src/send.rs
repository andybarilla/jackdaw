use interprocess::local_socket::{
    tokio::prelude::*,
    GenericFilePath, GenericNamespaced, ToFsName, ToNsName,
};
use std::io::{self, Read};
use tokio::io::AsyncWriteExt;

fn connect_name() -> io::Result<interprocess::local_socket::Name<'static>> {
    if cfg!(windows) {
        "jackdaw".to_ns_name::<GenericNamespaced>()
    } else {
        let home = dirs::home_dir().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "could not determine home directory")
        })?;
        let path = home.join(".jackdaw").join("jackdaw.sock");
        path.to_string_lossy().to_string().to_fs_name::<GenericFilePath>()
    }
}

pub fn run() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to create tokio runtime");

    rt.block_on(async {
        let mut payload = String::new();
        if let Err(e) = io::stdin().read_to_string(&mut payload) {
            eprintln!("jackdaw send: failed to read stdin: {}", e);
            std::process::exit(1);
        }

        let payload = payload.trim().to_string();
        if payload.is_empty() {
            eprintln!("jackdaw send: empty payload");
            std::process::exit(1);
        }

        let name = match connect_name() {
            Ok(n) => n,
            Err(e) => {
                eprintln!("jackdaw send: invalid socket name: {}", e);
                std::process::exit(1);
            }
        };

        let mut stream = match interprocess::local_socket::tokio::Stream::connect(name).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("jackdaw send: failed to connect (is Jackdaw running?): {}", e);
                std::process::exit(1);
            }
        };

        let message = format!("{}\n", payload);
        if let Err(e) = stream.write_all(message.as_bytes()).await {
            eprintln!("jackdaw send: failed to send: {}", e);
            std::process::exit(1);
        }
    });
}
