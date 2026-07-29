from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from video_resize import (  # noqa: E402
    build_scale_filter,
    default_output_path,
    probe_video,
)


class HelperTests(unittest.TestCase):
    def test_scale_filter_preserves_ratio_and_prevents_upscaling(self) -> None:
        scale_filter = build_scale_filter(1280, 720)

        self.assertIn("min(iw,1280)", scale_filter)
        self.assertIn("min(ih,720)", scale_filter)
        self.assertIn("force_original_aspect_ratio=decrease", scale_filter)
        self.assertIn("force_divisible_by=2", scale_filter)
        self.assertIn("setsar=1", scale_filter)

    def test_scale_filter_rejects_invalid_dimensions(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "至少为 2"):
            build_scale_filter(0, 720)

    def test_default_output_path(self) -> None:
        result = default_output_path(Path("demo.source.mov"), "720p")

        self.assertEqual(result, Path("demo.source_720p.mp4"))


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"),
    "FFmpeg and ffprobe are required",
)
class IntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        assert ffmpeg is not None
        assert ffprobe is not None
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe

    def generate_test_video(self, input_path: Path) -> None:
        generate_command = [
            self.ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=24:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=1",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
            str(input_path),
        ]
        subprocess.run(generate_command, check=True)

    def run_cli_resize(self, input_path: Path, output_path: Path, encoder: str) -> None:
        resize_command = [
            sys.executable,
            str(PROJECT_DIR / "video_resize.py"),
            str(input_path),
            "-o",
            str(output_path),
            "--max-width",
            "320",
            "--max-height",
            "180",
            "--encoder",
            encoder,
        ]
        subprocess.run(resize_command, check=True)

    def assert_valid_output(self, output_path: Path) -> None:
        output_info = probe_video(self.ffprobe, output_path)
        self.assertEqual((output_info.width, output_info.height), (320, 180))
        self.assertEqual(output_info.video_codec, "h264")
        self.assertIsNotNone(output_info.audio_codec)

    def test_cli_resizes_landscape_video_with_cpu_and_keeps_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temp_directory:
            temp_path = Path(temp_directory)
            input_path = temp_path / "input.mp4"
            output_path = temp_path / "output.mp4"

            self.generate_test_video(input_path)
            self.run_cli_resize(input_path, output_path, "cpu")
            self.assert_valid_output(output_path)

    def test_cli_auto_encoder_produces_valid_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_directory:
            temp_path = Path(temp_directory)
            input_path = temp_path / "input.mp4"
            output_path = temp_path / "output.mp4"

            self.generate_test_video(input_path)
            self.run_cli_resize(input_path, output_path, "auto")
            self.assert_valid_output(output_path)


if __name__ == "__main__":
    unittest.main()
