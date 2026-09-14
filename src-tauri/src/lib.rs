//! Tauri 桌面外壳（第七阶段）。
//!
//! 架构原则：**Web 应用是唯一本体，这里只是「壳」**——一套代码双发布渠道，
//! 浏览器版走 GitHub Pages，桌面版出 exe。所以这个文件只做「网页做不到的事」：
//!
//! 1. **单实例锁**：第二次启动不再开一份，而是把已有窗口拉到前台
//! 2. **窗口状态记忆**：位置/尺寸/最大化状态由 window-state 插件负责
//! 3. **系统托盘 + 关闭到托盘**：这是桌面版相对网页版的**功能级增量**——
//!    关掉窗口后秒表与提醒仍在后台跑，到点照常弹 Windows 原生通知
//! 4. 通知 / shell 插件：提醒走原生通知、外链唤起系统浏览器
//!
//! 注意：`tauri-plugin-single-instance` **必须是第一个注册的插件**
//! （官方要求：它要最先拿到进程启动事件，否则第二次启动会走完整初始化）。

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// 把主窗口显示出来并聚焦（托盘菜单、托盘左键、第二次启动都用它）
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例锁必须最先注册：第二次启动时聚焦已有窗口，而不是开第二份
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ---- 系统托盘 ----
            //
            // ⚠️ 托盘**只能在这里建一次**：不要在 `tauri.conf.json` 里再写 `app.trayIcon`。
            // Tauri 会把配置里声明的托盘也 `build()` 一次（app.rs 的
            // "initialize default tray icon if defined"），而托盘图标一旦 `register()`
            // 就进了 App 的资源表 —— 即使丢弃返回值也不会被回收（tray/mod.rs 里
            // `TrayIcon` 的文档写着「最后一个实例析构时才移除」）。
            // 结果就是**通知区出现两个图标**，且配置那个没有任何菜单、点了没反应。
            // 实测证据：配置块存在时进程内有 2 个 `tray_icon_app` 隐藏窗口（tray-icon 库
            // 每个 TrayIcon 建一个），删掉配置块后只剩 1 个。
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    // `default_window_icon()` 由 `bundle.icon` 提供，实测有值
                    // （主窗口 WM_GETICON 返回非 0 句柄）。这里只是不 panic 的兜底；
                    // 真要走到这，图标会是 1×1 透明 —— 能点但看不见。
                    tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)
                }))
                .tooltip("云海工作台")
                .menu(&menu)
                // 左键单击直接开窗口（菜单只走右键），符合 Windows 托盘习惯
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    // 托盘菜单的「退出」才是真正退出：关闭窗口是躲进托盘
                    "quit" => {
                        // 退出前先把窗口状态落盘。
                        //
                        // 别指望插件自己写：`AppHandle::exit` 的实现是
                        // `cleanup_before_exit()` + `std::process::exit(code)`（tauri/src/app.rs:574），
                        // **直接退进程、从不发送 `RunEvent::Exit`**，所以插件注册在
                        // `RunEvent::Exit` 上的那次保存永远不会执行（实测：托盘退出后
                        // .window-state.json 的时间戳不推进）。
                        // 少了这一句，用户「调好大小 → 直接托盘退出」的窗口状态就丢了。
                        let _ = app.save_window_state(StateFlags::all());
                        app.exit(0)
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 关闭 = 最小化到托盘（微信式），而不是退出进程：
                // 秒表 tick 与提醒调度都在前端跑，窗口藏起来它们继续工作。
                api.prevent_close();
                let _ = window.hide();

                // 顺手把窗口状态落盘。
                //
                // window-state 插件默认只在 `RunEvent::Exit`（真正退出）时才写文件，
                // 而本应用的「关闭」是隐藏到托盘 —— 如果用户习惯只点关闭、从不点托盘里的
                // 「退出」，那么位置/尺寸永远不会被保存，「窗口状态记忆」就等于没生效。
                // 这里在隐藏的同时显式保存一次，让最常见的用法也能记住窗口。
                let _ = window.app_handle().save_window_state(StateFlags::all());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
