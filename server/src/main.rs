use std::net::SocketAddr;

use futures_util::{SinkExt, StreamExt};
use sim::protocol::{Welcome, SPECTATOR};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const BIND: &str = "127.0.0.1:9876";

async fn handle_conn(stream: TcpStream, addr: SocketAddr) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[{addr}] handshake failed: {e}");
            return;
        }
    };
    println!("[{addr}] connected");

    let (mut tx, mut rx) = ws.split();

    let welcome = Welcome {
        your_slot: SPECTATOR,
        map: "de_douglas".into(),
        seed: 1,
        server_tick: 0,
    };
    if let Err(e) = tx.send(Message::Binary(welcome.encode().into())).await {
        eprintln!("[{addr}] send error: {e}");
        return;
    }

    while let Some(Ok(msg)) = rx.next().await {
        match msg {
            Message::Binary(data) => {
                if tx.send(Message::Binary(data)).await.is_err() {
                    break;
                }
            }
            Message::Ping(data) => {
                let _ = tx.send(Message::Pong(data)).await;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    println!("[{addr}] disconnected");
}

#[tokio::main]
async fn main() {
    let listener = TcpListener::bind(BIND).await.expect("bind");
    println!("deathmatch server listening on ws://{BIND}");

    while let Ok((stream, addr)) = listener.accept().await {
        tokio::spawn(handle_conn(stream, addr));
    }
}
