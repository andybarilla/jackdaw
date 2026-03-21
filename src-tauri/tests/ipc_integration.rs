use interprocess::local_socket::{
    tokio::prelude::*,
    GenericFilePath, ListenerOptions, ToFsName,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::test]
async fn ipc_roundtrip_sends_and_receives_json() {
    let dir = tempfile::tempdir().unwrap();
    let sock_path = dir.path().join("test.sock");
    let sock_str = sock_path.to_string_lossy().to_string();

    let name = sock_str.clone().to_fs_name::<GenericFilePath>().unwrap();
    let listener = ListenerOptions::new().name(name).create_tokio().unwrap();

    let sock_str_clone = sock_str.clone();
    let sender = tokio::spawn(async move {
        let name = sock_str_clone.to_fs_name::<GenericFilePath>().unwrap();
        let mut stream = interprocess::local_socket::tokio::Stream::connect(name).await.unwrap();
        let payload = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        stream.write_all(format!("{}\n", payload).as_bytes()).await.unwrap();
    });

    let stream = listener.accept().await.unwrap();
    let reader = BufReader::new(stream);
    let mut lines = reader.lines();
    let line = lines.next_line().await.unwrap().unwrap();

    sender.await.unwrap();

    let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(parsed["session_id"], "s1");
    assert_eq!(parsed["hook_event_name"], "SessionStart");
}
