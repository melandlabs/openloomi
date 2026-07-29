from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence


VIDEO_SUFFIXES = {".mp4", ".m4v", ".mov", ".mkv"}


if os.name == "nt":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class BatchResizeError(RuntimeError):
    pass


@dataclass(frozen=True)
class MediaInfo:
    width: int
    height: int
    duration_seconds: float
    bit_rate: int
    video_codec: str
    pixel_format: str
    frame_rate: str
    audio_codec: str | None
    spherical: bool

    @property
    def is_10_bit(self) -> bool:
        return "10" in self.pixel_format or self.pixel_format in {"p010le", "p010be"}


@dataclass
class FileResult:
    source: str
    output: str
    status: str
    source_resolution: str
    output_resolution: str | None = None
    source_pixel_format: str = ""
    output_pixel_format: str | None = None
    source_bit_rate_mbps: float = 0
    output_bit_rate_mbps: float | None = None
    elapsed_seconds: float = 0
    error: str | None = None


def find_program(name: str) -> str:
    program = shutil.which(name)
    if program is None:
        raise BatchResizeError(
            f"找不到 {name}，请先运行：conda activate video-resizer"
        )
    return program


def probe_media(ffprobe: str, path: Path) -> MediaInfo:
    command = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        (
            "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate:"
            "stream_side_data:format=duration,bit_rate"
        ),
        "-of",
        "json",
        str(path),
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
        raise BatchResizeError(
            f"ffprobe 无法读取 {path.name}：{result.stderr.strip()}"
        )

    try:
        payload = json.loads(result.stdout)
        streams = payload["streams"]
        video = next(stream for stream in streams if stream["codec_type"] == "video")
        audio = next(
            (stream for stream in streams if stream["codec_type"] == "audio"),
            None,
        )
        duration = float(payload["format"]["duration"])
        bit_rate = int(payload["format"].get("bit_rate") or 0)
    except (KeyError, StopIteration, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise BatchResizeError(f"无法解析 {path.name} 的媒体信息") from exc

    side_data = video.get("side_data_list") or []
    spherical = any(
        "spherical" in str(item.get("side_data_type", "")).lower()
        for item in side_data
    )
    return MediaInfo(
        width=int(video["width"]),
        height=int(video["height"]),
        duration_seconds=duration,
        bit_rate=bit_rate,
        video_codec=str(video.get("codec_name", "unknown")),
        pixel_format=str(video.get("pix_fmt", "unknown")),
        frame_rate=str(video.get("r_frame_rate", "unknown")),
        audio_codec=str(audio.get("codec_name", "unknown")) if audio else None,
        spherical=spherical,
    )


def choose_rates(source_bit_rate: int) -> tuple[int, int, int]:
    source_mbps = source_bit_rate / 1_000_000 if source_bit_rate > 0 else 20
    target_mbps = min(20, max(12, round(source_mbps * 0.65)))
    maximum_mbps = round(target_mbps * 1.5)
    buffer_mbps = target_mbps * 2
    return target_mbps, maximum_mbps, buffer_mbps


def build_command(
    *,
    ffmpeg: str,
    source: Path,
    temporary_output: Path,
    info: MediaInfo,
    width: int,
    height: int,
    quality: int,
) -> list[str]:
    target_rate, maximum_rate, buffer_size = choose_rates(info.bit_rate)
    cuda_format = "p010le" if info.is_10_bit else "yuv420p"
    profile = "main10" if info.is_10_bit else "main"
    scale_filter = (
        f"scale_cuda={width}:{height}:"
        f"interp_algo=lanczos:format={cuda_format}:passthrough=0"
    )

    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-hwaccel",
        "cuda",
        "-hwaccel_output_format",
        "cuda",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-map_metadata",
        "0",
        "-map_chapters",
        "0",
        "-vf",
        scale_filter,
        "-c:v",
        "hevc_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-rc",
        "vbr",
        "-cq",
        str(quality),
        "-b:v",
        f"{target_rate}M",
        "-maxrate",
        f"{maximum_rate}M",
        "-bufsize",
        f"{buffer_size}M",
        "-multipass",
        "qres",
        "-rc-lookahead",
        "16",
        "-spatial-aq",
        "1",
        "-temporal-aq",
        "1",
        "-aq-strength",
        "8",
        "-bf",
        "3",
        "-b_ref_mode",
        "middle",
        "-profile:v",
        profile,
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        "-y",
        str(temporary_output),
    ]
    return command


def run_with_progress(
    command: Sequence[str],
    *,
    file_number: int,
    file_count: int,
    file_name: str,
    duration_seconds: float,
) -> tuple[int, str]:
    process = subprocess.Popen(
        list(command),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None

    diagnostics: list[str] = []
    last_percent = -1
    speed = "?"
    try:
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue
            key, separator, value = line.partition("=")
            if separator and key == "speed":
                speed = value
                continue
            if separator and key in {"out_time_us", "out_time_ms"}:
                try:
                    elapsed = int(value) / 1_000_000
                    percent = min(100, int(elapsed / duration_seconds * 100))
                except (ValueError, ZeroDivisionError):
                    continue
                if percent >= last_percent + 2:
                    print(
                        f"[{file_number}/{file_count}] {file_name}："
                        f"{percent:3d}%  speed={speed}",
                        flush=True,
                    )
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
                "stream_0_0_q",
                "total_size",
            }:
                continue
            diagnostics.append(line)
        return_code = process.wait()
    except KeyboardInterrupt:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        raise
    finally:
        process.stdout.close()

    return return_code, "\n".join(diagnostics[-40:])


def is_valid_existing_output(
    ffprobe: str,
    output: Path,
    expected_width: int,
    expected_height: int,
) -> bool:
    try:
        info = probe_media(ffprobe, output)
    except BatchResizeError:
        return False
    return (
        info.width == expected_width
        and info.height == expected_height
        and info.video_codec == "hevc"
        and info.duration_seconds > 0
    )


def save_report(report_path: Path, results: list[FileResult]) -> None:
    payload = {
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "results": [asdict(result) for result in results],
    }
    temporary_report = report_path.with_suffix(".json.tmp")
    temporary_report.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary_report, report_path)


def run_batch(
    *,
    input_directory: Path,
    output_directory: Path,
    width: int,
    height: int,
    quality: int,
) -> int:
    ffmpeg = find_program("ffmpeg")
    ffprobe = find_program("ffprobe")
    input_directory = input_directory.expanduser().resolve()
    output_directory = output_directory.expanduser().resolve()

    if not input_directory.is_dir():
        raise BatchResizeError(f"输入目录不存在：{input_directory}")
    if width < 2 or height < 2 or width % 2 or height % 2:
        raise BatchResizeError("目标宽高必须是不小于 2 的偶数")
    if not 1 <= quality <= 51:
        raise BatchResizeError("质量参数必须在 1 到 51 之间")

    sources = sorted(
        (
            path
            for path in input_directory.iterdir()
            if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES
        ),
        key=lambda path: path.name.casefold(),
    )
    if not sources:
        raise BatchResizeError(f"目录中没有支持的视频：{input_directory}")

    output_directory.mkdir(parents=True, exist_ok=True)
    report_path = output_directory / "conversion-report.json"
    results: list[FileResult] = []

    print(f"输入目录：{input_directory}", flush=True)
    print(f"输出目录：{output_directory}", flush=True)
    print(f"文件数量：{len(sources)}", flush=True)
    print(f"目标规格：{width}x{height} / HEVC NVENC / CQ {quality}", flush=True)
    print(f"FFmpeg：{ffmpeg}", flush=True)

    for index, source in enumerate(sources, start=1):
        output = output_directory / source.with_suffix(".mp4").name
        info = probe_media(ffprobe, source)
        result = FileResult(
            source=str(source),
            output=str(output),
            status="pending",
            source_resolution=f"{info.width}x{info.height}",
            source_pixel_format=info.pixel_format,
            source_bit_rate_mbps=round(info.bit_rate / 1_000_000, 2),
        )
        results.append(result)

        if is_valid_existing_output(ffprobe, output, width, height):
            output_info = probe_media(ffprobe, output)
            result.status = "skipped_valid"
            result.output_resolution = f"{output_info.width}x{output_info.height}"
            result.output_pixel_format = output_info.pixel_format
            result.output_bit_rate_mbps = round(
                output_info.bit_rate / 1_000_000, 2
            )
            print(f"[{index}/{len(sources)}] 已存在且验证通过，跳过：{output.name}")
            save_report(report_path, results)
            continue
        if output.exists():
            result.status = "failed"
            result.error = "输出文件已存在但验证未通过；为安全起见没有覆盖"
            print(f"[{index}/{len(sources)}] 错误：{result.error}：{output}")
            save_report(report_path, results)
            continue

        target_rate, maximum_rate, _ = choose_rates(info.bit_rate)
        bit_depth = "10-bit" if info.is_10_bit else "8-bit"
        print(
            f"[{index}/{len(sources)}] 开始：{source.name}\n"
            f"  {info.width}x{info.height} / {bit_depth} / "
            f"{info.frame_rate} / {info.duration_seconds / 60:.2f} 分钟\n"
            f"  码率策略：目标 {target_rate} Mbps，峰值 {maximum_rate} Mbps",
            flush=True,
        )

        token = uuid.uuid4().hex[:10]
        temporary_output = output.with_name(
            f".{output.stem}.{token}.partial{output.suffix}"
        )
        command = build_command(
            ffmpeg=ffmpeg,
            source=source,
            temporary_output=temporary_output,
            info=info,
            width=width,
            height=height,
            quality=quality,
        )
        started_at = time.monotonic()
        try:
            return_code, diagnostics = run_with_progress(
                command,
                file_number=index,
                file_count=len(sources),
                file_name=source.name,
                duration_seconds=info.duration_seconds,
            )
            if return_code != 0:
                raise BatchResizeError(
                    diagnostics or f"FFmpeg 返回错误码 {return_code}"
                )

            output_info = probe_media(ffprobe, temporary_output)
            if (
                output_info.width != width
                or output_info.height != height
                or output_info.video_codec != "hevc"
                or output_info.duration_seconds < info.duration_seconds - 2
            ):
                raise BatchResizeError(
                    "输出验证失败：分辨率、编码或时长与预期不符"
                )
            if info.is_10_bit and not output_info.is_10_bit:
                raise BatchResizeError("输出验证失败：10-bit 源视频被降为 8-bit")

            os.replace(temporary_output, output)
            result.status = "completed"
            result.output_resolution = f"{output_info.width}x{output_info.height}"
            result.output_pixel_format = output_info.pixel_format
            result.output_bit_rate_mbps = round(
                output_info.bit_rate / 1_000_000, 2
            )
            print(
                f"[{index}/{len(sources)}] 完成：{output.name} / "
                f"{result.output_pixel_format} / "
                f"{result.output_bit_rate_mbps} Mbps",
                flush=True,
            )
        except KeyboardInterrupt:
            temporary_output.unlink(missing_ok=True)
            result.status = "interrupted"
            result.error = "用户中断"
            result.elapsed_seconds = round(time.monotonic() - started_at, 2)
            save_report(report_path, results)
            print("批处理已中断；已完成文件会保留，下次运行将自动跳过。")
            return 130
        except Exception as exc:
            temporary_output.unlink(missing_ok=True)
            result.status = "failed"
            result.error = str(exc)
            print(f"[{index}/{len(sources)}] 失败：{source.name}\n{exc}", flush=True)
        finally:
            result.elapsed_seconds = round(time.monotonic() - started_at, 2)
            save_report(report_path, results)

    completed = sum(result.status == "completed" for result in results)
    skipped = sum(result.status == "skipped_valid" for result in results)
    failed = sum(result.status == "failed" for result in results)
    print(
        f"批处理结束：新完成 {completed}，已验证跳过 {skipped}，失败 {failed}\n"
        f"报告：{report_path}",
        flush=True,
    )
    return 1 if failed else 0


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="批量将 2:1 的 8K 360° 视频转换为 4096x2048 HEVC。",
    )
    parser.add_argument("input_directory", type=Path, help="源视频目录")
    parser.add_argument(
        "-o",
        "--output-directory",
        type=Path,
        help="输出目录（默认：源目录下的 4096x2048）",
    )
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=2048)
    parser.add_argument(
        "--quality",
        type=int,
        default=21,
        help="NVENC CQ 质量，越低画质越高（默认：21）",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = create_parser()
    args = parser.parse_args(argv)
    output_directory = args.output_directory or (
        args.input_directory / f"{args.width}x{args.height}"
    )
    try:
        return run_batch(
            input_directory=args.input_directory,
            output_directory=output_directory,
            width=args.width,
            height=args.height,
            quality=args.quality,
        )
    except BatchResizeError as exc:
        parser.exit(1, f"错误：{exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
