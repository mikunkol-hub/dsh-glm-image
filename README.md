# dsh-glm-image

让 DeepSeek Harness 的 Agent 直接调用智谱 **GLM-Image** 文生图模型生成图片的插件。

- Agent 工具 `generate_image`：按文字描述生成图片 → 自动下载 → 保存到当前会话工作目录（默认 `glm-images/`）→ 同时在对话里展示预览。
- 插件配置面板：DSH 插件页点进「GLM-Image 图像生成」，页面上直接出现配置区（与 dsh-wechat-emoji 同款交互）：API Key、模型、默认尺寸、默认画质、AI 水印开关、接口地址、保存目录。保存立即生效。

## 安装

1. 在 DSH 的「插件」面板选择「添加插件 → 本地目录」，选中本目录；或通过 npm 安装：
   ```bash
   pnpm add dsh-glm-image
   ```
2. 在「插件 → 已安装」里启用 `dsh-glm-image`。
3. 点进插件页面，在配置区填入智谱 API Key（[open.bigmodel.cn](https://open.bigmodel.cn) → API 密钥），保存。

## 使用

在对话里直接说「用 generate_image 画一张 …」，或调用工具：

```
generate_image(prompt: "一只圆滚滚的橘猫坐在窗台上，午后阳光，卡通插画风格")
```

可选参数：`size`（如 1280x1280、1568x1056、960x1728）、`quality`（hd/standard）、`filename`（保存文件名，默认时间戳）。

## 支持的模型

| 模型 | 说明 |
|---|---|
| `glm-image` | 智谱新旗舰文生图模型（默认），仅支持 hd 画质 |
| `cogview-4-250304` | CogView-4（2025-03-04 版本） |
| `cogview-4` | CogView-4 |
| `cogview-3-flash` | 旧版快速模型 |

价格以智谱官方定价为准（glm-image 约 0.1 元/张）。生成的图片链接有效期 30 天，插件会自动下载保存到本地。

## 配置说明

配置面板的保存优先于 bundle patch（`cordis.patch.yml`）；工具读取顺序为：面板设置文件（`<DSH_HOME>/glm-image-settings.json`）> 行配置 > 环境变量 `ZHIPU_API_KEY`。

- `size`：glm-image 推荐 1280x1280 / 1568x1056 / 1056x1568 / 1472x1088 / 1088x1472 / 1728x960 / 960x1728；自定义值需 1024–2048 且为 32 的倍数。
- `quality`：hd 约 20 秒、细节更丰富；standard 约 5–10 秒（glm-image 仅支持 hd）。
- `watermark`：默认开启 AI 水印；关闭需在智谱个人中心签署去水印协议。

## 开发

- Host 端（`index.js`）：工具注册、GLM API 调用、`/api/glm-image/settings` 配置读写端点（仅回环）。
- Web 端（`client.js`）：注册 `plugins.bundle.config` 槽位的自包含配置面板。
- 依赖：无 npm 运行时依赖。`vendor/` 内置 MIT 授权的 `@deepseek-ai/schemastery` 3.18.5 与 `@deepseek-ai/cosmokit` 1.8.6（来源与许可见 `THIRD_PARTY_NOTICES.md`）。

## License

MIT
