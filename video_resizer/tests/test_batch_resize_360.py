from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from batch_resize_360 import MediaInfo, build_command, choose_rates  # noqa: E402


class RateSelectionTests(unittest.TestCase):
    def test_low_bitrate_source_uses_safe_minimum(self) -> None:
        self.assertEqual(choose_rates(12_500_000), (12, 18, 24))

    def test_high_bitrate_source_is_capped(self) -> None:
        self.assertEqual(choose_rates(33_000_000), (20, 30, 40))


class CommandTests(unittest.TestCase):
    def test_10_bit_source_uses_main10_cuda_pipeline(self) -> None:
        info = MediaInfo(
            width=8192,
            height=4096,
            duration_seconds=60,
            bit_rate=30_000_000,
            video_codec="hevc",
            pixel_format="yuv420p10le",
            frame_rate="60000/1001",
            audio_codec="aac",
            spherical=False,
        )

        command = build_command(
            ffmpeg="ffmpeg",
            source=Path("input.mp4"),
            temporary_output=Path("output.mp4"),
            info=info,
            width=4096,
            height=2048,
            quality=21,
        )

        command_text = " ".join(str(value) for value in command)
        self.assertIn("scale_cuda=4096:2048", command_text)
        self.assertIn("format=p010le", command_text)
        self.assertIn("-profile:v main10", command_text)
        self.assertIn("-c:v hevc_nvenc", command_text)


if __name__ == "__main__":
    unittest.main()
