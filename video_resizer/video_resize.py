from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


if os.name == "nt":
    # Keep Chinese status messages readable when output is captured by PowerShell,
    # CI, or another parent process using UTF-8.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


RESOLUTIONS: dict[str, tuple[int, int]] = {
    "1080p": (1920, 1080),
    "720p": (1280, 720),
    "480p": (854, 480),
}
SUPPORTED_OUTPUT_SUFFIXES = {".mp4", ".m4v", ".mov", ".mkv"}


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    duration_seconds: float | None
    video_codec: str
    audio_codec: str | None


@dataclass(frozen=True)
class Encoder:
    key: str
    ffmpeg_name: str
    label: str

    def arguments(self, quality: int) -> list[str]:
        if self.key == "nvidia":
            return [
                "-c:v",
                self.ffmpeg_name,
                "-preset",
                "p4",
                "-tune",
                "hq",
                "-rc",
                "vbr",
                "-cq",
                str(quality),
                "-b:v",
                "0",
            ]
        if self.key == "intel":
            return [
                "-c:v",
                self.ffmpeg_name,
                "-preset",
                "medium",
                "-global_quality",
                str(quality),
            ]
        if self.key == "amd":
            return [
                "-c:v",
                self.ffmpeg_name,
                "-quality",
                "balanced",
                "-rc",
                "cqp",
                "-qp_i",
                str(quality),
                "-qp_p",
                str(quality),
                "-qp_b",
                str(min(quality + 2, 51)),
            ]
        return [
            "-c:v",
            self.ffmpeg_name,
            "-preset",
            "veryfast",
            "-crf",
            str(quality),
        ]


ENCODERS: dict[str, Encoder] = {
    "nvidia": Encoder("nvidia", "h264_nvenc", "NVIDIA NVENC"),
    "intel": Encoder("intel", "h264_qsv", "Intel Quick Sync"),
    "amd": Encoder("amd", "h264_amf", "AMD AMF"),
    "cpu": Encoder("cpu", "libx264", "CPU / libx264"),
}


class VideoResizeError(RuntimeError):
    pass


def find_ffmpeg_toolchains() -> list[tuple[str, str]]:
    executable_suffix = ".exe" if os.name == "nt" else ""
    search_directories: list[Path] = []

    configured_directory = os.environ.get("FFMPEG_DIR")
    if configured_directory:
        search_directories.append(Path(configured_directory).expanduser())

    for raw_directory in os.environ.get("PATH", "").split(os.pathsep):
        if raw_directory:
            search_directories.append(Path(raw_directory))

    discovered: list[tuple[str, str]] = []
    seen: set[str] = set()
    for directory in search_directories:
        ffmpeg_path = directory / f"ffmpeg{executable_suffix}"
        ffprobe_path = directory / f"ffprobe{executable_suffix}"
        if not ffmpeg_path.is_file() or not ffprobe_path.is_file():
            continue

        normalized = os.path.normcase(str(ffmpeg_path.resolve()))
        if normalized in seen:
            continue
        seen.add(normalized)
        discovered.append((str(ffmpeg_path.resolve()), str(ffprobe_path.resolve())))

    # This also supports launchers or executable aliases that are not normal files
    # in a PATH directory.
    default_ffmpeg = shutil.which("ffmpeg")
    default_ffprobe = shutil.which("ffprobe")
    if default_ffmpeg and default_ffprobe:
        normalized = os.path.normcase(str(Path(default_ffmpeg).resolve()))
        if normalized not in seen:
            discovered.insert(0, (default_ffmpeg, default_ffprobe))

    if not discovered:
        raise VideoResizeError(
            "找不到 ffmpeg 和 ffprobe。请先激活 Conda 环境："
            "conda activate video-resizer"
        )
    return discovered


def probe_video(ffprobe: str, input_path: Path) -> VideoInfo:
    command = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height:format=duration",
        "-of",
        "json",
        str(input_path),
    ]
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or "ffprobe 无法读取该文件"
        raise VideoResizeError(f"无法分析输入视频：{detail}")

    try:
        payload = json.loads(result.stdout)
        streams = payload.get("streams", [])
        video_stream = next(
            stream for stream in streams if stream.get("codec_type") == "video"
        )
    except (json.JSONDecodeError, StopIteration, TypeError) as exc:
        raise VideoResizeError("输入文件中没有可读取的视频轨道") from exc

    audio_stream = next(
        (stream for stream in streams if stream.get("codec_type") == "audio"),
        None,
    )
    duration_value = payload.get("format", {}).get("duration")
    try:
        duration = float(duration_value) if duration_value is not None else None
    except (TypeError, ValueError):
        duration = None

    return VideoInfo(
        width=int(video_stream["width"]),
        height=int(video_stream["height"]),
        duration_seconds=duration if duration and duration > 0 else None,
        video_codec=str(video_stream.get("codec_name", "unknown")),
        audio_codec=(
            str(audio_stream.get("codec_name", "unknown")) if audio_stream else None
        ),
    )


def build_scale_filter(max_width: int, max_height: int) -> str:
    if max_width < 2 or max_height < 2:
        raise VideoResizeError("目标宽度和高度必须至少为 2 像素")

    return (
        f"scale=w='min(iw,{max_width})':h='min(ih,{max_height})':"
        "force_original_aspect_ratio=decrease:force_divisible_by=2,"
        "setsar=1"
    )


def encoder_is_usable(ffmpeg: str, encoder: Encoder) -> bool:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        # 256x256 stays above the minimum frame size required by recent NVENC
        # hardware while keeping this one-frame capability probe inexpensive.
        "color=c=black:s=256x256:r=1:d=0.1",
        "-frames:v",
        "1",
        *encoder.arguments(23),
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def select_toolchain(requested_encoder: str) -> tuple[str, str, Encoder]:
    toolchains = find_ffmpeg_toolchains()

    if requested_encoder == "auto":
        for ffmpeg, ffprobe in toolchains:
            for key in ("nvidia", "intel", "amd"):
                encoder = ENCODERS[key]
                if encoder_is_usable(ffmpeg, encoder):
                    return ffmpeg, ffprobe, encoder

        for ffmpeg, ffprobe in toolchains:
            cpu_encoder = ENCODERS["cpu"]
            if encoder_is_usable(ffmpeg, cpu_encoder):
                return ffmpeg, ffprobe, cpu_encoder
        raise VideoResizeError("已找到 FFmpeg，但没有可用的 H.264 编码器")

    encoder = ENCODERS[requested_encoder]
    for ffmpeg, ffprobe in toolchains:
        if encoder_is_usable(ffmpeg, encoder):
            return ffmpeg, ffprobe, encoder
    raise VideoResizeError(
        f"已检查 {len(toolchains)} 个 FFmpeg 安装，"
        f"当前硬件仍无法使用 {encoder.label} 编码器"
    )


def choose_audio_arguments(
    output_path: Path, audio_codec: str | None, audio_mode: str
) -> list[str]:
    if audio_codec is None:
        return []
    if audio_mode == "aac":
        return ["-c:a", "aac", "-b:a", "192k"]
    if audio_mode == "copy":
        return ["-c:a", "copy"]

    mp4_compatible_codecs = {"aac", "mp3", "ac3", "eac3", "alac"}
    is_mp4_family = output_path.suffix.lower() in {".mp4", ".m4v", ".mov"}
    if is_mp4_family and audio_codec not in mp4_compatible_codecs:
        return ["-c:a", "aac", "-b:a", "192k"]
    return ["-c:a", "copy"]


def temporary_output_path(output_path: Path) -> Path:
    token = uuid.uuid4().hex[:10]
    return output_path.with_name(
        f".{output_path.stem}.{token}.partial{output_path.suffix}"
    )


def run_ffmpeg_with_progress(
    command: Sequence[str],
    duration_seconds: float | None,
) -> tuple[int, str]:
    try:
        process = subprocess.Popen(
            list(command),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except OSError as exc:
        raise VideoResizeError(f"无法启动 FFmpeg：{exc}") from exc
    assert process.stdout is not None

    diagnostic_lines: list[str] = []
    last_percent = -1
    try:
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue

            key, separator, value = line.partition("=")
            if separator and key in {"out_time_us", "out_time_ms"}:
                if duration_seconds:
                    try:
                        # FFmpeg currently reports both fields in microseconds.
                        elapsed_seconds = int(value) / 1_000_000
                        percent = min(
                            100, int(elapsed_seconds / duration_seconds * 100)
                        )
                    except ValueError:
                        continue
                    if percent >= last_percent + 2:
                        print(f"\r处理进度：{percent:3d}%", end="", flush=True)
                        last_percent = percent
                continue
            if separator and key in {
                "bitrate",
                "drop_frames",
                "dup_frames",
                "fps",
                "frame",
                "out_time",
                "progress",
                "speed",
                "stream_0_0_q",
                "total_size",
            }:
                continue
            diagnostic_lines.append(line)

        return_code = process.wait()
    except KeyboardInterrupt:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        raise
    finally:
        process.stdout.close()

    if last_percent >= 0:
        if return_code == 0:
            print("\r处理进度：100%")
        else:
            print()
    return return_code, "\n".join(diagnostic_lines[-30:])


def build_ffmpeg_command(
    *,
    ffmpeg: str,
    input_path: Path,
    temporary_path: Path,
    max_width: int,
    max_height: int,
    encoder: Encoder,
    quality: int,
    audio_codec: str | None,
    audio_mode: str,
) -> list[str]:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(input_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-map_metadata",
        "0",
        "-map_chapters",
        "0",
        "-vf",
        build_scale_filter(max_width, max_height),
        *encoder.arguments(quality),
        "-pix_fmt",
        "yuv420p",
        *choose_audio_arguments(temporary_path, audio_codec, audio_mode),
    ]
    if temporary_path.suffix.lower() in {".mp4", ".m4v", ".mov"}:
        command.extend(["-movflags", "+faststart"])
    command.extend(["-progress", "pipe:1", "-nostats", str(temporary_path)])
    return command


def resize_video(
    *,
    input_path: Path,
    output_path: Path,
    max_width: int,
    max_height: int,
    encoder_name: str = "auto",
    quality: int = 23,
    audio_mode: str = "auto",
    overwrite: bool = False,
) -> None:
    input_path = input_path.expanduser().resolve()
    output_path = output_path.expanduser().resolve()

    if not input_path.is_file():
        raise VideoResizeError(f"输入文件不存在：{input_path}")
    if input_path == output_path:
        raise VideoResizeError("输入与输出不能是同一个文件")
    if output_path.exists() and not overwrite:
        raise VideoResizeError(
            f"输出文件已经存在：{output_path}\n如需覆盖，请增加 --overwrite"
        )
    if output_path.suffix.lower() not in SUPPORTED_OUTPUT_SUFFIXES:
        supported = "、".join(sorted(SUPPORTED_OUTPUT_SUFFIXES))
        raise VideoResizeError(f"输出格式必须是以下之一：{supported}")
    if not 0 <= quality <= 51:
        raise VideoResizeError("quality 必须在 0 到 51 之间")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg, ffprobe, encoder = select_toolchain(encoder_name)
    info = probe_video(ffprobe, input_path)

    print(
        f"输入：{info.width}x{info.height} / {info.video_codec}"
        f" / 时长 {format_duration(info.duration_seconds)}"
    )
    print(f"限制：{max_width}x{max_height}（保持比例、不放大）")
    print(f"编码器：{encoder.label}")
    print(f"FFmpeg：{ffmpeg}")

    if info.width <= max_width and info.height <= max_height:
        print("提示：源视频已在目标范围内，将保持原分辨率并重新编码。")

    temporary_path = temporary_output_path(output_path)
    command = build_ffmpeg_command(
        ffmpeg=ffmpeg,
        input_path=input_path,
        temporary_path=temporary_path,
        max_width=max_width,
        max_height=max_height,
        encoder=encoder,
        quality=quality,
        audio_codec=info.audio_codec,
        audio_mode=audio_mode,
    )

    try:
        return_code, diagnostics = run_ffmpeg_with_progress(
            command, info.duration_seconds
        )
        if return_code != 0 and encoder_name == "auto" and encoder.key != "cpu":
            failed_encoder = encoder
            temporary_path.unlink(missing_ok=True)
            try:
                ffmpeg, _, encoder = select_toolchain("cpu")
            except VideoResizeError as exc:
                raise VideoResizeError(
                    f"{failed_encoder.label} 编码失败，CPU 编码器也不可用"
                ) from exc
            print(f"{failed_encoder.label} 编码失败，改用 {encoder.label} 重新处理。")
            command = build_ffmpeg_command(
                ffmpeg=ffmpeg,
                input_path=input_path,
                temporary_path=temporary_path,
                max_width=max_width,
                max_height=max_height,
                encoder=encoder,
                quality=quality,
                audio_codec=info.audio_codec,
                audio_mode=audio_mode,
            )
            return_code, diagnostics = run_ffmpeg_with_progress(
                command, info.duration_seconds
            )

        if return_code != 0:
            detail = diagnostics or "FFmpeg 未返回详细错误"
            raise VideoResizeError(f"视频处理失败：\n{detail}")

        os.replace(temporary_path, output_path)
    except KeyboardInterrupt as exc:
        temporary_path.unlink(missing_ok=True)
        raise VideoResizeError("操作已取消，临时文件已清理") from exc
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    output_info = probe_video(ffprobe, output_path)
    print(
        f"完成：{output_path}\n"
        f"输出：{output_info.width}x{output_info.height}"
        f" / {output_info.video_codec}"
        f" / {format_file_size(output_path.stat().st_size)}"
    )


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "未知"
    total_seconds = max(0, round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds_part = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds_part:02d}"
    return f"{minutes:02d}:{seconds_part:02d}"


def format_file_size(size_bytes: int) -> str:
    size = float(size_bytes)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if size < 1024 or unit == "GiB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GiB"


def default_output_path(input_path: Path, resolution: str) -> Path:
    return input_path.with_name(f"{input_path.stem}_{resolution}.mp4")


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="使用 FFmpeg 快速降低视频分辨率，自动选择硬件编码器。",
    )
    parser.add_argument("input", type=Path, help="输入视频路径")
    parser.add_argument("-o", "--output", type=Path, help="输出视频路径")
    parser.add_argument(
        "-r",
        "--resolution",
        choices=tuple(RESOLUTIONS),
        default="1080p",
        help="分辨率上限（默认：1080p）",
    )
    parser.add_argument("--max-width", type=int, help="覆盖预设的最大宽度")
    parser.add_argument("--max-height", type=int, help="覆盖预设的最大高度")
    parser.add_argument(
        "--encoder",
        choices=("auto", "nvidia", "intel", "amd", "cpu"),
        default="auto",
        help="视频编码器（默认：自动探测硬件，失败时回退 CPU）",
    )
    parser.add_argument(
        "-q",
        "--quality",
        type=int,
        default=23,
        help="质量参数 0-51，越低画质越高、文件越大（默认：23）",
    )
    parser.add_argument(
        "--audio",
        choices=("auto", "copy", "aac"),
        default="auto",
        help="音频处理方式（默认：兼容时直接复制）",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="允许覆盖已经存在的输出文件",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = create_parser()
    args = parser.parse_args(argv)
    preset_width, preset_height = RESOLUTIONS[args.resolution]
    max_width = args.max_width if args.max_width is not None else preset_width
    max_height = args.max_height if args.max_height is not None else preset_height
    output_path = args.output or default_output_path(args.input, args.resolution)

    try:
        resize_video(
            input_path=args.input,
            output_path=output_path,
            max_width=max_width,
            max_height=max_height,
            encoder_name=args.encoder,
            quality=args.quality,
            audio_mode=args.audio,
            overwrite=args.overwrite,
        )
    except VideoResizeError as exc:
        parser.exit(1, f"错误：{exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
