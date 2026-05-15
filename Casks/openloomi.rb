cask "openloomi" do
  if Hardware::CPU.intel?
    version "0.5.0"
    sha256 "df80da2df07406d0986d17238670cd0b720ed70e97b9acdfca9f038e57e59abd"
    url "https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_macOS_amd64.dmg"
  else
    version "0.5.0"
    sha256 "ad7f00baa1634d39c40e1b900b0745576347e331e7f7e4e7746fa9b76c68cd50"
    url "https://github.com/melandlabs/openloomi/releases/download/v0.5.0/openloomi_0.5.0_macOS_aarch64.dmg"
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
