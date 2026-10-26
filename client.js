// GLM-Image 插件（Web 端）：bundle 配置区面板，注册到 plugins.bundle.config
// （key = 包名），与 dsh-wechat-emoji 完全同款：设置页 → 插件 → 点进
// 「GLM-Image 图像生成」，配置区直接出现在页面上。自包含 fetch 面板，
// 数据经 /api/glm-image/settings 读写，不依赖任何 props。
window.__ModuleLoader__.load({
  id: '@local/glm-image',
  factory(require) {
    const React = require('react')
    const { useState, useEffect } = React
    const h = React.createElement

    const inputStyle = {
      width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13,
      borderRadius: 6, border: '1px solid var(--dsw-alias-stroke-secondary, #8883)', outline: 'none', background: 'transparent', color: 'inherit',
    }
    const buttonStyle = {
      alignSelf: 'flex-start', padding: '6px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
      border: '1px solid var(--dsw-alias-stroke-secondary, #8883)', background: 'transparent', color: 'inherit',
    }
    const rowStyle = { display: 'flex', flexDirection: 'column', gap: 4 }
    const labelStyle = { fontSize: 13, opacity: 0.9 }
    const hintStyle = { fontSize: 12, opacity: 0.65 }

    const MODELS = ['glm-image', 'cogview-4-250304', 'cogview-4', 'cogview-3-flash']

    function SettingsPanel() {
      const [loaded, setLoaded] = useState(false)
      const [apiKey, setApiKey] = useState('')
      const [hasKey, setHasKey] = useState(false)
      const [keyTail, setKeyTail] = useState('')
      const [model, setModel] = useState('glm-image')
      const [size, setSize] = useState('1280x1280')
      const [quality, setQuality] = useState('hd')
      const [watermark, setWatermark] = useState(true)
      const [baseURL, setBaseURL] = useState('')
      const [saveDirectory, setSaveDirectory] = useState('')
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')

      useEffect(() => {
        fetch('/api/glm-image/settings')
          .then((r) => r.json())
          .then((d) => {
            if (!d?.ok) return
            const s = d.settings ?? {}
            setHasKey(!!s.hasKey); setKeyTail(s.keyTail ?? '')
            if (s.model) setModel(s.model)
            if (s.size) setSize(s.size)
            if (s.quality) setQuality(s.quality)
            setWatermark(s.watermark !== false)
            if (s.baseURL) setBaseURL(s.baseURL)
            if (s.saveDirectory) setSaveDirectory(s.saveDirectory)
            setLoaded(true)
          })
          .catch(() => setLoaded(true))
      }, [])

      const save = async () => {
        setBusy(true); setMsg('')
        try {
          const r = await fetch('/api/glm-image/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey, model, size, quality, watermark, baseURL, saveDirectory }),
          })
          const d = await r.json()
          if (d?.ok) {
            if (apiKey.trim()) { setHasKey(true); setKeyTail('…' + apiKey.trim().slice(-4)) }
            setApiKey('')
            setMsg('已保存，立即生效')
          } else {
            setMsg('保存失败：' + (d?.error ?? r.status))
          }
        } catch (error) {
          setMsg('保存失败：' + String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0 8px' } },
        h('div', { style: labelStyle },
          hasKey ? `智谱 API Key 已设置（${keyTail}）` : '智谱 API Key 未设置（必填，否则无法生成图片）'),
        h('input', {
          type: 'password',
          placeholder: hasKey ? '粘贴新 Key 覆盖，留空保持现有 Key' : '粘贴智谱 API Key',
          value: apiKey, autoComplete: 'off', spellCheck: false,
          style: inputStyle,
          onChange: (e) => setApiKey(e.target.value),
        }),
        h('div', { style: rowStyle },
          h('label', { style: labelStyle }, '模型'),
          h('select', { value: model, style: inputStyle, onChange: (e) => setModel(e.target.value) },
            MODELS.map((m) => h('option', { key: m, value: m }, m))),
          h('div', { style: hintStyle }, 'glm-image 为智谱新旗舰文生图模型；cogview 系列为旧版模型。')),
        h('div', { style: rowStyle },
          h('label', { style: labelStyle }, '默认尺寸（宽×高）'),
          h('input', {
            value: size, spellCheck: false, style: inputStyle,
            placeholder: '1280x1280',
            onChange: (e) => setSize(e.target.value),
          }),
          h('div', { style: hintStyle }, '如 1280x1280、1568x1056、1056x1568、1728x960、960x1728；自定义值需 1024–2048 且为 32 的倍数。')),
        h('div', { style: rowStyle },
          h('label', { style: labelStyle }, '默认画质'),
          h('select', { value: quality, style: inputStyle, onChange: (e) => setQuality(e.target.value) },
            h('option', { value: 'hd' }, 'hd · 精细（约 20 秒）'),
            h('option', { value: 'standard' }, 'standard · 快速（约 5-10 秒）')),
          h('div', { style: hintStyle }, 'glm-image 仅支持 hd，其它模型两者均可。')),
        h('label', { style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { type: 'checkbox', checked: watermark, onChange: (e) => setWatermark(e.target.checked) }),
          '添加 AI 水印（关闭需在智谱个人中心签署去水印协议）'),
        h('div', { style: rowStyle },
          h('label', { style: labelStyle }, '接口地址'),
          h('input', {
            value: baseURL, spellCheck: false, style: inputStyle,
            placeholder: 'https://open.bigmodel.cn/api/paas/v4',
            onChange: (e) => setBaseURL(e.target.value),
          }),
          h('div', { style: hintStyle }, '一般无需修改。')),
        h('div', { style: rowStyle },
          h('label', { style: labelStyle }, '保存目录'),
          h('input', {
            value: saveDirectory, spellCheck: false, style: inputStyle,
            placeholder: 'glm-images',
            onChange: (e) => setSaveDirectory(e.target.value),
          }),
          h('div', { style: hintStyle }, '生成的图片保存到会话工作目录下的这个子目录。')),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { onClick: save, disabled: busy, style: buttonStyle }, busy ? '保存中…' : '保存'),
          msg ? h('span', { style: { fontSize: 12, opacity: 0.85 } }, msg) : null),
        h('div', { style: hintStyle },
          '获取 Key：open.bigmodel.cn → API 密钥。glm-image 模型 0.1 元/张。'),
        loaded ? null : h('div', { style: hintStyle }, '正在读取配置…')
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: '@local/glm-image' },
          SettingsPanel,
        ))
      },
    }
  },
})
