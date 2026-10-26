/**
 * GLM-Image 图像生成插件（Host 端）
 *
 * - 通过智谱开放平台 API（https://open.bigmodel.cn）调用 GLM-Image 文生图模型；
 * - 为 Agent 注册 `generate_image` 工具：按文字描述生成图片、下载并保存到
 *   当前会话工作目录，同时登记为会话附件以便在对话中直接预览；
 * - 设置持久化：Web 配置面板（plugins.bundle.config，同 dsh-wechat-emoji 模式）
 *   经 /api/glm-image/settings 读写侧车文件 <DSH_HOME>/glm-image-settings.json；
 *   工具读取顺序 = 面板文件 > 行配置 > 环境变量 ZHIPU_API_KEY。
 */
import { readFileSync, renameSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import os from "node:os";
import z from "./vendor/schemastery.mjs";

export const name = "glm-image";
export const inject = ["tools", "webServer"];

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-image";
const DEFAULT_SIZE = "1280x1280";
const DEFAULT_QUALITY = "hd";
const DEFAULT_SAVE_DIRECTORY = "glm-images";

export const MODELS = ["glm-image", "cogview-4-250304", "cogview-4", "cogview-3-flash"];

/** glm-image 推荐尺寸；其它模型可用 1024x1024 等，由用户自定义填写。 */
export const GLM_SIZES = [
  "1280x1280",
  "1568x1056",
  "1056x1568",
  "1472x1088",
  "1088x1472",
  "1728x960",
  "960x1728",
];

export const Config = z.object({
  apiKey: z.string().role("secret").volatile(),
  baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
  model: z.union(MODELS).default(DEFAULT_MODEL).volatile(),
  size: z.string().default(DEFAULT_SIZE).volatile(),
  quality: z.union(["hd", "standard"]).default(DEFAULT_QUALITY).volatile(),
  watermark: z.boolean().default(true).volatile(),
  saveDirectory: z.string().default(DEFAULT_SAVE_DIRECTORY).volatile(),
});

/** 面板设置侧车文件（同 dsh-wechat-emoji 的 key 文件模式）。 */
const SETTINGS_FILE = join(
  process.env.DSH_HOME || join(os.homedir(), ".dsh"),
  "glm-image-settings.json"
);

function readSettingsFile() {
  try {
    const value = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

function writeSettingsFile(settings) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const temp = SETTINGS_FILE + ".tmp";
  writeFileSync(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(temp, SETTINGS_FILE);
}

/** 读取当前生效配置：面板文件 > 行配置（volatile）> 默认值。 */
function options(config) {
  const panel = readSettingsFile();
  const pick = (field, fallback) => {
    const fromPanel = panel[field];
    if (fromPanel !== undefined && fromPanel !== null && fromPanel !== "") return fromPanel;
    const fromConfig = config[field]?.get();
    return fromConfig ?? fallback;
  };
  return {
    apiKey: String(pick("apiKey", "")).trim(),
    baseURL: String(pick("baseURL", DEFAULT_BASE_URL)).trim().replace(/\/+$/, ""),
    model: String(pick("model", DEFAULT_MODEL)),
    size: String(pick("size", DEFAULT_SIZE)),
    quality: String(pick("quality", DEFAULT_QUALITY)) === "standard" ? "standard" : "hd",
    watermark: Boolean(pick("watermark", true)),
    saveDirectory: String(pick("saveDirectory", DEFAULT_SAVE_DIRECTORY) || DEFAULT_SAVE_DIRECTORY),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 带退避重试的图像生成请求。 */
async function generateImage(baseURL, apiKey, payload, signal) {
  const endpoint = `${baseURL}/images/generations`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return await response.json();
    let detail = "";
    try { detail = (await response.text()).slice(0, 400); } catch {}
    lastError = new Error(`智谱 API 返回 HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    if (response.status !== 429 && response.status < 500) throw lastError;
    if (attempt < 3) await sleep(3000 * attempt);
  }
  throw lastError;
}

/** 依据文件头魔数判定真实图片媒体类型（优先），再退回 Content-Type / URL 提示。 */
function sniffMediaType(data, contentType, url) {
  const b = data;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const source = `${contentType ?? ""} ${url ?? ""}`.toLowerCase();
  if (source.includes("png")) return "image/png";
  if (source.includes("webp")) return "image/webp";
  if (source.includes("gif")) return "image/gif";
  return "image/jpeg";
}

/** 安全的文件名：只保留字母数字、下划线、中划线。 */
function sanitizeFilename(value) {
  const base = String(value ?? "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 80);
  return base || `glm-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

const EXTENSIONS = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
};

const SETTING_FIELDS = ["baseURL", "model", "size", "quality", "watermark", "saveDirectory"];

export function apply(ctx, config) {
  ctx.tools.register({
    name: "generate_image",
    description:
      "调用智谱 GLM-Image 文生图模型，根据文字描述生成一张图片，自动下载并保存到当前会话工作目录，返回保存路径并在对话中展示预览。适合海报、插画、配图、表情包等图像产出任务。生成通常需要 5-20 秒。",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "图像的文字描述，中文或英文，越具体越好（画面主体、风格、构图、氛围、画面中要出现的文字等），最长 1000 字符。",
        },
        size: {
          type: "string",
          description:
            "输出尺寸，如 1280x1280、1568x1056、1056x1568、1728x960、960x1728；留空则使用插件配置页设置的默认尺寸。",
        },
        quality: {
          type: "string",
          enum: ["hd", "standard"],
          description:
            "画质：hd 细节更丰富、整体更一致（约 20 秒）；standard 更快（约 5-10 秒）。glm-image 模型仅支持 hd，其它模型两者均可。留空则用配置页默认值。",
        },
        filename: {
          type: "string",
          description:
            "保存的文件名（不含扩展名），留空自动用时间戳命名。仅允许字母、数字、下划线和连字符。",
        },
      },
      required: ["prompt"],
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["savedPath"],
        properties: {
          savedPath: {
            type: "string",
            description: "生成的图片在会话工作目录中的保存路径。",
          },
          url: {
            type: "string",
            description: "智谱返回的临时图片链接，有效期 30 天，仅作备用。",
          },
          model: { type: "string", description: "本次使用的模型。" },
          size: { type: "string", description: "实际输出尺寸。" },
          image: {
            type: "object",
            description: "供对话内展示的图片信息。",
            properties: {
              attachmentId: { type: "string" },
              mediaType: { type: "string" },
              bytes: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              name: { type: "string" },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: `已生成图片并保存到 ${value.savedPath}\n（智谱临时链接：${value.url}）`,
        },
        ...(value.image && value.image.attachmentId
          ? [{ type: "image", attachment: value.image }]
          : []),
      ],
    },
    timeoutMs: 180000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const prompt = String(args.prompt ?? "").trim();
      if (prompt.length === 0) throw new Error("prompt 不能为空：请描述要生成的画面。");

      const opt = options(config);
      if (!opt.apiKey) {
        throw new Error(
          "尚未配置智谱 API Key。请在「插件 → GLM-Image 图像生成」页面的配置区填写 API Key（可在 https://bigmodel.cn 获取）。"
        );
      }

      const size = String(args.size ?? "").trim() || opt.size;
      const quality = args.quality ?? opt.quality;

      const payload = {
        model: opt.model,
        prompt: prompt.length > 1000 ? prompt.slice(0, 1000) : prompt,
        size,
        watermark_enabled: opt.watermark,
      };
      // glm-image 仅支持 hd，不发 quality；其它模型带上用户选择的画质。
      if (opt.model !== "glm-image") payload.quality = quality === "standard" ? "standard" : "hd";

      const result = await generateImage(opt.baseURL, opt.apiKey, payload, exec.signal);
      const url = result?.data?.[0]?.url;
      if (!url) {
        throw new Error(
          `GLM-Image 未返回图片链接：${JSON.stringify(result ?? {}).slice(0, 300)}`
        );
      }

      const download = await fetch(url, { signal: exec.signal });
      if (!download.ok) throw new Error(`下载生成图片失败：HTTP ${download.status}`);
      const data = new Uint8Array(await download.arrayBuffer());
      if (data.length === 0) throw new Error("下载到的图片为空。");
      const mediaType = sniffMediaType(data, download.headers.get("content-type"), url);

      // 保存到当前会话工作目录。
      const workingDirectory = ctx.get("workingDirectory");
      const cwd = workingDirectory
        ? await workingDirectory.ensure(exec.agent, exec.signal)
        : process.cwd();
      const dir = join(cwd, opt.saveDirectory);
      await mkdir(dir, { recursive: true });
      const name = sanitizeFilename(args.filename);
      const ext = EXTENSIONS[mediaType] ?? "jpg";
      const savedPath = join(dir, `${name}.${ext}`);
      await writeFile(savedPath, data);

      // 登记为会话附件，让对话 UI 直接渲染预览。
      let image;
      const attachments = ctx.get("attachments");
      if (attachments) {
        try {
          const ref = await attachments.saveImage({ data, mediaType, name: `${name}.${ext}` });
          image = {
            attachmentId: ref.attachmentId,
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...(ref.name === undefined ? {} : { name: ref.name }),
          };
        } catch (error) {
          // 附件失败不阻断图片保存，但记日志便于排查“图没显示”的原因。
          try {
            writeFileSync(
              join(process.env.DSH_HOME || join(os.homedir(), ".dsh"), "glm-image-attach-error.log"),
              `${new Date().toISOString()} saveImage failed: ${String(error?.stack ?? error)}\n`,
              { flag: "a" }
            );
          } catch {}
          image = undefined;
        }
      }

      return {
        savedPath,
        url,
        model: opt.model,
        size,
        ...(image ? { image } : {}),
      };
    },
  });

  // ── 配置面板后端：/api/glm-image/settings（仅回环，同 dsh-wechat-emoji 模式）──
  const json = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(new Error("PAYLOAD_TOO_LARGE"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          reject(new Error("BAD_JSON"));
        }
      });
      req.on("error", reject);
    });
  const loopbackOnly = (req) => {
    const address = String(req.socket?.remoteAddress ?? "");
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  };

  const disposeRoute = ctx.webServer.register({
    kind: "exact",
    path: "/api/glm-image/settings",
    handler: async (req, res) => {
      if (!loopbackOnly(req)) return json(res, 403, { ok: false, error: "LOOPBACK_ONLY" });
      if (req.method === "GET") {
        const current = options(config);
        const hasKey = current.apiKey.length > 0;
        return json(res, 200, {
          ok: true,
          settings: {
            hasKey,
            keyTail: hasKey ? "…" + current.apiKey.slice(-4) : "",
            baseURL: current.baseURL,
            model: current.model,
            size: current.size,
            quality: current.quality,
            watermark: current.watermark,
            saveDirectory: current.saveDirectory,
          },
        });
      }
      if (req.method === "POST") {
        let body;
        try {
          body = await readBody(req);
        } catch {
          return json(res, 400, { ok: false, error: "BAD_REQUEST" });
        }
        if (typeof body !== "object" || body === null) {
          return json(res, 400, { ok: false, error: "INVALID_BODY" });
        }
        const merged = readSettingsFile();
        if (typeof body.apiKey === "string") {
          const key = body.apiKey.trim();
          if (key.length > 200) return json(res, 400, { ok: false, error: "INVALID_API_KEY" });
          if (key.length > 0) merged.apiKey = key;
        }
        for (const field of ["baseURL", "model", "size", "quality", "saveDirectory"]) {
          if (typeof body[field] === "string" && body[field].trim().length > 0) {
            merged[field] = body[field].trim();
          }
        }
        if (typeof body.watermark === "boolean") merged.watermark = body.watermark;
        // 与行配置一致的字段不再重复存侧车文件。
        for (const field of SETTING_FIELDS) {
          const fromConfig = config[field]?.get();
          if (merged[field] === fromConfig) delete merged[field];
        }
        try {
          writeSettingsFile(merged);
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 500, {
            ok: false,
            error: "SAVE_FAILED",
            detail: String(error?.message ?? error).slice(0, 200),
          });
        }
      }
      return json(res, 404, { ok: false, error: "NOT_FOUND" });
    },
  });
  ctx.effect(() => disposeRoute);
}
