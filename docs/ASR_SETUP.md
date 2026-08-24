# 自托管中文 ASR（语音转文字）部署指南

前端录音 → `POST /api/asr/transcribe` → 服务器调用 `ASR_COMMAND` 指定的本地模型 → 返回文本填入聊天框。

## 1. 推荐模型（ARM CPU 亦可）

| 方案 | 特点 | 安装 |
|------|------|------|
| **SenseVoice Small (sherpa-onnx)** | 中文最佳、带标点、RTF≈0.07 极快 | `pip install sherpa-onnx` + 下载 onnx 模型 |
| faster-whisper small | 多语言通用、int8 后 CPU 可用 | `pip install faster-whisper` |

## 2. 包装脚本示例

### SenseVoice（`/srv/asr/sensevoice.py`）

```python
import sys, wave, contextlib
from sherpa_onnx import OfflineRecognizer
# 模型下载: https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
# 文件: sherpa-onnx-sensevoice-zh-en-ja-ko-yue-2024-07-17.tar.bz2
rec = OfflineRecognizer.from_sensevoice(
    "sense-voice/model.int8.onnx", "sense-voice/tokens.txt", use_itn=True)
wav_path = sys.argv[1]
with contextlib.closing(wave.open(wav_path, "rb")) as w:
    assert w.getframerate() == 16000, "需 16k wav，见下方 ffmpeg 转码"
print(rec.decode_wave_file(wav_path)[0].text)
```

> 录音是 webm/opus，需要先转 16k wav。最简单方式是把 ASR_COMMAND 包一层 ffmpeg：
> ```bash
> ASR_COMMAND="sh -c 'ffmpeg -y -loglevel error -i {input} -ar 16000 /tmp/a.wav && python3 /srv/asr/sensevoice.py /tmp/a.wav'"
> ```
> （compose 的 environment 里注意 `$` 转义；也可写进 /srv/asr/run.sh 再指向它）

### faster-whisper（`/srv/asr/faster_whisper.py`）

```python
import sys
from faster_whisper import WhisperModel
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[-1], language="zh", vad_filter=True)
print("".join(s.text for s in segments).strip())
```

## 3. 配置

`.env`（或 systemd Environment）：

```bash
ASR_COMMAND="bash /srv/asr/run.sh {input}"
```

规则：
- `{input}` 占位符替换为临时音频绝对路径（webm/m4a/wav…）
- 命令必须把**识别文本打印到 stdout**
- 超时 110s；修改后重启服务生效（`systemctl restart baby-panel`）

## 4. 验证

```bash
curl -F "audio=@test.webm" -H "Cookie: baby_auth_token=<你的token>" \
     http://127.0.0.1:3088/api/asr/transcribe
# {"text":"刚才十二点半睡了四十分钟"}
```

未配置时接口返回 503 与提示，聊天页麦克风按钮会 toast 说明。
