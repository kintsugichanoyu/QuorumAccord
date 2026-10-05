//! Serves the built Quorum frontend and its bundled mdBook using Rust.
use std::{env, error::Error, io, path::PathBuf};

use axum::{
    http::{header, HeaderValue},
    Router,
};
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let root = env::var_os("QUORUM_WEB_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("dist"));
    if !root.join("index.html").is_file() || !root.join("book/workers.html").is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Build the frontend and handbook first: npm --prefix frontend ci && npm --prefix frontend run build",
        ).into());
    }

    let app = Router::new().fallback_service(ServeDir::new(root)).layer(
        SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ),
    );
    let address = env::var("QUORUM_WEB_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("Quorum frontend: http://{}", listener.local_addr()?);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
