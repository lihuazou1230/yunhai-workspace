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
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    // 理论上一定有默认图标（bundle.icon 里配了 ico），这里只是不 panic
                    tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)
                }))
                .tooltip("智能工作台")
                .menu(&menu)
                // 左键单击直接开窗口（菜单只走右键），符合 Windows 托盘习惯
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    // 托盘菜单的「退出」才是真正退出：关闭窗口是躲进托盘
                    "quit" => app.exit(0),
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
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
