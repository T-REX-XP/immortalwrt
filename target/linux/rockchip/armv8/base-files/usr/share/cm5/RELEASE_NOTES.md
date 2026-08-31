# Orange Pi CM5 Base — image notes

**Date:** 2026-08-31

On the router: `cat /usr/share/cm5/RELEASE_NOTES.md`

ImmortalWrt 25.x (`rockchip/armv8`), kernel 6.18. LAN `192.168.8.1/24` on `br-lan` (`eth1` + `eth2`); WAN `eth0`.

## This image

### MCU display

- LuCI **Services → MCU Display** (`luci-app-mcu-display` r54)
- Host daemon: Go `mcudd` 1.0.0-r13 on `/dev/ttyS2` at 115200 8N1 (debug UART; no kernel console on ttyS2)
- Serial tools: `picocom`, `screen`, `socat` (stop `mcudd` first)

### Network, DNS, remote access

- Blocky DNS + LuCI; clients → dnsmasq `:53` → Blocky `127.0.0.1:5353`
- WireGuard, AmneziaWG, Tailscale, Cloudflared
- `openssh-sftp-server` so host `scp` / `sftp` works with Dropbear

### Platform

- PWM fan, USERKEY / MaskROM (`cm5-button-scripts`), USB Wi-Fi (`kmod-mt76x2u`, `kmod-rtl8812au-ct`)
- Peripherals LuCI: **System → Peripherals** (fan, I2C, IR)

## Not in this image

Docker, travelmate, yggdrasil, luci-app-oled, SMB, DLNA, SQM, PBR, statistics, speedtest. Install from a feed if needed.

## Since 2026-08-28

- Go `mcudd` is baked into the image (package prepare copies `go.mod` / `cmd` / `internal`)
- MCU Display FIFO / LuCI command logging (`mcud-event.sh help`)
- SFTP into Dropbear; `picocom` / `screen` / `socat` on ttyS2
- Default image no longer includes yggdrasil
