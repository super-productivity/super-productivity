use std::env;
use std::error::Error;
use std::io::{self, ErrorKind, Write};
use std::process;

use wayland_client::globals::{registry_queue_init, GlobalListContents};
use wayland_client::protocol::wl_registry::WlRegistry;
use wayland_client::protocol::wl_seat::WlSeat;
use wayland_client::{delegate_noop, Connection, Dispatch, EventQueue, QueueHandle};
use wayland_protocols::ext::idle_notify::v1::client::ext_idle_notification_v1::{
    Event as IdleNotificationEvent, ExtIdleNotificationV1,
};
use wayland_protocols::ext::idle_notify::v1::client::ext_idle_notifier_v1::ExtIdleNotifierV1;

struct AppState {
    stdout: io::Stdout,
    _seat: WlSeat,
    _notifier: ExtIdleNotifierV1,
    _notification: ExtIdleNotificationV1,
}

impl AppState {
    fn emit(&mut self, event: &str) {
        let mut lock = self.stdout.lock();
        if let Err(err) = writeln!(lock, "{event}").and_then(|_| lock.flush()) {
            if err.kind() == ErrorKind::BrokenPipe {
                process::exit(0);
            }
            eprintln!("failed to write event: {err}");
        }
    }
}

delegate_noop!(AppState: ignore WlSeat);
delegate_noop!(AppState: ignore ExtIdleNotifierV1);

impl Dispatch<WlRegistry, GlobalListContents> for AppState {
    fn event(
        _state: &mut Self,
        _proxy: &WlRegistry,
        _event: wayland_client::protocol::wl_registry::Event,
        _data: &GlobalListContents,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ExtIdleNotificationV1, ()> for AppState {
    fn event(
        state: &mut Self,
        _proxy: &ExtIdleNotificationV1,
        event: IdleNotificationEvent,
        _data: &(),
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        match event {
            IdleNotificationEvent::Idled => state.emit("idle"),
            IdleNotificationEvent::Resumed => state.emit("resumed"),
            _ => {}
        }
    }
}

fn parse_timeout_ms() -> Result<u32, Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    match args.as_slice() {
        [_, flag, value] if flag == "--timeout-ms" => Ok(value.parse::<u32>()?),
        _ => Err("usage: wayland-idle-helper --timeout-ms <ms>".into()),
    }
}

fn init_wayland(
    timeout_ms: u32,
) -> Result<(Connection, EventQueue<AppState>, AppState), Box<dyn Error>> {
    let conn = Connection::connect_to_env()?;
    let (globals, event_queue) = registry_queue_init::<AppState>(&conn)?;
    let qh = event_queue.handle();

    let seat: WlSeat = globals.bind(&qh, 1..=9, ())?;
    let notifier: ExtIdleNotifierV1 = globals.bind(&qh, 1..=2, ())?;
    let notification = notifier.get_idle_notification(timeout_ms, &seat, &qh, ());

    Ok((
        conn,
        event_queue,
        // Keep these Wayland objects alive for the lifetime of the connection.
        AppState {
            stdout: io::stdout(),
            _seat: seat,
            _notifier: notifier,
            _notification: notification,
        },
    ))
}

fn run() -> Result<(), Box<dyn Error>> {
    let timeout_ms = parse_timeout_ms()?;
    let (_conn, mut event_queue, mut state) = init_wayland(timeout_ms)?;

    state.emit("ready");

    loop {
        event_queue.blocking_dispatch(&mut state)?;
    }
}

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        process::exit(1);
    }
}
