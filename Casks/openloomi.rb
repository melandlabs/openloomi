cask "openloomi" do
  if Hardware::CPU.intel?
    version "0.7.6"
    sha256 "07761f7dc90dc642f90268c7c0a815e57025dd648cca1d740bf8ad24d30ce26b"
    url "https://github.com/melandlabs/openloomi/releases/download/v0.7.6/openloomi_0.7.6_macOS_amd64.dmg"
  else
    version "0.7.6"
    sha256 "8fdb7197095013a9286d899a674bf226b2fd25a305cc525abaf395740e72df3d"
    url "https://github.com/melandlabs/openloomi/releases/download/v0.7.6/openloomi_0.7.6_macOS_aarch64.dmg"
  end

  name "openloomi"
  desc "Open source AI workspace assistant"
  homepage "https://github.com/melandlabs/openloomi"

  auto_updates true

  app "openloomi.app"

  zap trash: [
    "~/Library/Application Support/com.openloomi.app",
    "~/Library/Logs/openloomi",
  ]
end
