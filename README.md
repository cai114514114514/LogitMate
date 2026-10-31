# LogitMate

任何 Live2D 模型拖进来都能活过来的 AI 桌宠（macOS，Tauri 2）。

- 产品需求：[docs/PRD.md](docs/PRD.md)
- 架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 运行

1. 在 <https://www.live2d.com/sdk/download/web/> 同意协议，下载 Cubism SDK for Web 5，解压为 `app/vendor/cubism`（不进 git）。
2. 运行（在 app 目录下）：

```bash
pnpm install
pnpm test
LOGITMATE_MODEL="/path/to/model.model3.json" pnpm tauri dev
```

不设置 `LOGITMATE_MODEL` 时，首次启动会弹出文件选择框；之后可以在菜单栏图标里切换模型、调整大小、开关置顶。

## 许可证

LogitMate 的源代码以 [MIT 协议](LICENSE) 开源。

MIT 协议只覆盖本仓库里的代码，不包括：

- **Live2D Cubism SDK**：Live2D 公司的专有软件，需要你自己在官网同意协议后下载。商业发布须遵守 Live2D 的 SDK 发布许可。
- **Live2D 模型**：版权归各自的作者。LogitMate 只读取你本地的模型文件，不复制、不上传；公开使用前请阅读模型附带的条款并注明作者。
