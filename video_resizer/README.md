# 视频降分辨率工具

这是一个基于 FFmpeg 的 Python 命令行工具。它会保持原始宽高比、避免放大低分辨率视频，并优先使用 NVIDIA NVENC、Intel Quick Sync 或 AMD AMF；自动模式下硬件编码失败会回退到 CPU。

## 创建和激活环境

在本目录中运行：

```powershell
conda env create -f environment.yml
conda activate video-resizer
```

如果环境已经存在，需要按配置更新：

```powershell
conda env update -f environment.yml --prune
```

## 使用

降到 1080p 范围：

```powershell
python video_resize.py "D:\videos\input.mp4"
```

降到 720p，并指定输出：

```powershell
python video_resize.py "D:\videos\input.mp4" `
  --resolution 720p `
  --output "D:\videos\output_720p.mp4"
```

强制使用 NVIDIA NVENC：

```powershell
python video_resize.py input.mp4 --resolution 720p --encoder nvidia
```

自定义最大尺寸：

```powershell
python video_resize.py input.mp4 --max-width 960 --max-height 540
```

输出文件已经存在时，必须显式允许覆盖：

```powershell
python video_resize.py input.mp4 --resolution 720p --overwrite
```

主要参数：

- `--resolution 1080p|720p|480p`：常用分辨率上限。
- `--encoder auto|nvidia|intel|amd|cpu`：选择编码器。
- `--quality 0-51`：越低画质越高、文件越大，默认值为 23。
- `--audio auto|copy|aac`：兼容时默认直接复制音频。
- `--max-width`、`--max-height`：覆盖分辨率预设。
- `--overwrite`：允许覆盖已有输出。

查看全部参数：

```powershell
python video_resize.py --help
```

## 批量转换 8K 360° 视频

批量工具针对 2:1 的 360° 视频，使用 GPU 完成 HEVC 解码、Lanczos 缩放和 HEVC NVENC 编码。它会保留源视频的 8/10-bit 位深，并将结果写入独立子目录：

```powershell
python batch_resize_360.py "D:\迅雷下载\ship"
```

默认输出目录为 `D:\迅雷下载\ship\4096x2048`。每个文件完成后都会重新检查分辨率、编码、位深和时长，并把状态写入 `conversion-report.json`。重复运行时，已经验证通过的输出会自动跳过。

## 测试

```powershell
python -m unittest discover -s tests -v
```
