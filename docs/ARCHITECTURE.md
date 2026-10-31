# LogitMate 架构

```
Tauri 2 (Rust, app/src-tauri)                  WebView (TypeScript, app/src)
├─ lib.rs        命令、插件、启动               ├─ main.ts            启动流程、托盘菜单、窗口尺寸
├─ cursor.rs     60Hz 全局鼠标 → pet://cursor   ├─ model/adapter.ts   ModelAdapter：多源合并 → model3 + 档案
├─ tray.rs       菜单栏图标与菜单               ├─ model/loader.ts    通过 Tauri 读取模型目录
├─ model_files.rs 列出模型目录、开放 asset 范围 ├─ renderer/petModel.ts  CubismUserModel 子类
└─ settings.rs   settings.json（模型路径/位置）  ├─ renderer/stage.ts   WebGL2 画布、帧循环、像素命中
                                                ├─ renderer/textures.ts 贴图缩小加载
                                                ├─ behavior/interaction.ts 注视、穿透、拖拽、点击
                                                └─ behavior/reactions.ts   按标签选表情/动作
```

## 关键流程

### 加载模型
1. `get_settings` 读取模型路径（开发时可用环境变量 `LOGITMATE_MODEL` 指定）。
2. `list_model_files` 列出模型目录，并把该目录加入 asset 协议的读取范围（只加这一个目录，不开放整个 Home）。
3. `ModelAdapter.normalizeModel` 依次合并 model3.json、`*.vtube.json` 热键、文件夹扫描和 cdi3 参数名，产出**补全后的 model3**（只在内存里，不写盘）和 **ModelProfile**（表情和动作的标签、待机组、能力位）。
4. `PetModel.load` 把补全后的 model3 交给官方 `CubismModelSettingJson`，依次加载 moc、表情、物理、姿势、动作，再创建渲染器和贴图。

### 渲染与贴图
- 窗口尺寸按模型画布的宽高比设置，投影矩阵把整个模型放进窗口。
- 贴图缩放比例 = min(1, 最大显示高度 × 1.5 / 模型画布像素高度)。解码后先画到 OffscreenCanvas，再以 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 上传——WebKit 对 ImageBitmap 的 premultiplyAlpha 选项处理不可靠，绕道 canvas 后各引擎行为一致。
- 遮罩纹理张数 = ceil(带遮罩的部件数 / 36)。一张纹理只能装 36 个遮罩，超出的部件会不经裁剪直接画出来（例如嘴里的部件露在外面）。

### 点击穿透
- 窗口默认忽略鼠标事件（点击穿透）。Rust 每 16ms 推送一次全局鼠标坐标（换算成窗口内的逻辑像素）。
- 每帧绘制完后，前端用 `readPixels` 读取鼠标下那个像素的 alpha：alpha > 16 时关闭穿透，否则打开。只在状态变化时调用 `set_ignore_cursor`。
- 窗口在加载开始时就显示（这时是透明且穿透的）：WebKit 会挂起隐藏的 WebView，模型加载会因此卡住。

### 交互
- 注视：以脸部（窗口高度 22% 处）为原点，经 tanh 软饱和后传给 `CubismLook`，鼠标离得再远也只是转头到极限。
- 拖拽：按下后移动超过 4px 算拖拽，按屏幕坐标移动窗口；窗口的水平速度驱动一个弹簧，叠加到 AngleZ 和 BodyAngleX/Z 上，物理系统再把它转成头发和裙子的摆动，松手后会回弹。
- 点击：点在窗口上部 32% 触发"摸头"，从带开心类标签的表情里随机挑一个，2.6 秒后恢复；点在身体上触发配对手势（"X打开"接"X关闭"）。

## 授权边界
- `vendor/cubism/`：用户下载的 Cubism SDK（专有授权），已 gitignore。
- `.cubism/framework/`：`pnpm sync:cubism` 生成，是 Framework 源码加上 `// @ts-nocheck` 的副本，让我们自己的 strict tsconfig 不被 SDK 的非 strict 代码拖累。
- `public/cubism/`：Core 和 shader 的副本，供 Vite 提供。
- 模型文件只按路径引用，测试夹具通过环境变量 `LOGITMATE_MODEL_DIR` 指向本地副本。

## 开发
```bash
cd app
pnpm install
pnpm sync:cubism          # 需要先把 SDK 放到 vendor/cubism
pnpm test                 # ModelAdapter、手势配对
cd src-tauri && cargo test  # 设置存取、目录列举、坐标换算
LOGITMATE_MODEL=/path/to/x.model3.json pnpm tauri dev
```
