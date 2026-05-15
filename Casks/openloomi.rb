cask "openloomi" do
  if Hardware::CPU.intel?
    version "0.5.0"
    sha256 "placeholder"
    url "https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_amd64.dmg"
  else
    version "0.5.0"
    sha256 "placeholder"
    url "https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_aarch64.dmg"
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
