<img src="https://avatars.githubusercontent.com/u/53193414?s=200&v=4" alt="ImmortalWrt" width="160" height="160" align="right">

# ImmortalWrt for Orange Pi CM5 Base

A community-oriented [ImmortalWrt](https://github.com/immortalwrt/immortalwrt) / [OpenWrt](https://openwrt.org) fork focused on the **Xunlong Orange Pi CM5 Base** (Rockchip RK3588S).

The goal is a ready-to-flash router image: correct networking out of the box, useful VPN/remote-access tools, OLED/MCU accessory support, PWM fan and front-panel buttons, plus USB Wi-Fi hotspot helpers — without turning the image into a kitchen-sink appliance.

Upstream ImmortalWrt remains supported for hundreds of other devices; this tree defaults the Rockchip armv8 profile to CM5 Base and carries CM5-specific device-tree and runtime work.

---

## Quick facts

| | |
|---|---|
| **Device** | Orange Pi CM5 Base (`xunlong_orangepi-cm5-base`) |
| **SoC** | Rockchip RK3588S |
| **Kernel** | Linux 6.18 |
| **LuCI** | https://192.168.8.1 (HTTPS) — user `root`, **no password** by default |
| **LAN** | `br-lan` on **eth1 + eth2** → `192.168.8.1/24` |
| **WAN** | **eth0** (onboard, DHCP) |
| **Images** | `bin/targets/rockchip/armv8/*-sysupgrade.img.gz` |

> Change the root password on first login. This is not the stock ImmortalWrt `192.168.1.1` default.

---

## What this fork implements

### Hardware & kernel (device tree)

CM5 bring-up lives under `target/linux/rockchip/patches-6.18/` (994–9999 series):

- Full **CM5 Base DTS** (board, eMMC, Ethernet, USB, PCIe)
- **PWM fan** on PWM13 with OpenWrt `pwm-fan` / `kmod-hwmon-pwmfan`
- **GPIO buttons** (USERKEY / MaskROM) for `kmod-button-hotplug`
- **USB VBUS** startup delay for reliable peripheral power-up
- **FPC I2C7** for the Waveshare OLED HAT (`/dev/i2c-7`)
- **OLED RST** on GPIO1_B4 plus SoC pull-ups
- **WAN/LAN LED** PWM polarity fixes so link LEDs behave correctly

### Networking (first boot)

- Stable PCIe eth naming: LAN ports on `eth1`/`eth2`, WAN on `eth0`
- Automatic migration if an older image left LAN on `eth0` or `192.168.1.1` / `192.168.2.1`
- Status / WAN / LAN1 / LAN2 LED mapping aligned with the silkscreen
- Realtek r8125 driver for the 2.5G PCIe NICs

### Display, buttons & peripherals

- **OLED** (`oledd` + LuCI **Services → OLED**) on the Waveshare HAT
- **MCU display** LuCI app for companion MCU UIs
- **Peripherals** LuCI page (I2C bus scan and related tools)
- Button handlers (`cm5-button-scripts`) that chain into the OLED menu via hotplug
- `i2c-tools` / `gpiod-tools` for bring-up and debugging

### VPN, remote access & services (baked into the image)

| Area | Included |
|------|----------|
| VPN / mesh | WireGuard, AmneziaWG, Tailscale, Cloudflared (+ LuCI where available) |
| Admin UI | LuCI SSL, dashboard / network / status modules, custom commands |
| Convenience | Wake-on-LAN, bandwidth monitor (`nlbwmon`), web terminal (`ttyd`) |
| Wi-Fi USB | MediaTek MT76x2u & Realtek 8812AU drivers, hostapd, auto hotspot helpers |

Intentionally **not** in the default image: Docker, travelmate, Blocky, PBR, fwknopd, privoxy, watchcat, speedtest, SMB, DLNA, collectd statistics, SQM. Add those yourself via feeds if you need them.

Custom LuCI/daemons come from the sibling **`openwrt-packages`** feed and are compiled into the image (they are not expected as live apk downloads from ImmortalWrt mirrors).

### Wi-Fi hotspot helpers

USB Wi-Fi sticks are configured once into a 5 GHz-preferring AP (with a 2.4 GHz fallback). Credentials land in `/etc/credentials/cm5-wifi-ap`. Modeswitch quirks cover MT7612U-style “installer CD” devices so they appear as WLAN instead of storage.

---

## Flash & first boot

1. Build or obtain a sysupgrade image from `bin/targets/rockchip/armv8/`.
2. Write the `.img.gz` to a microSD card **or** eMMC (same image; U-Boot prefers eMMC when present).
3. Boot the board, wait ~1–2 minutes for first-boot scripts.
4. Connect a PC to a **LAN** port (eth1/eth2), open https://192.168.8.1, log in as `root`.
5. Set a password, then configure WAN / VPN / OLED as needed.

Serial note: the CM5 bootscript leaves **ttyS2 free for the MCU display** at 115200; early boot still uses earlycon. For console debugging, restore `console=ttyS2,...` via `fw_setenv` when needed.

---

## Build your own image

### Linux (recommended)

Needs a case-sensitive filesystem, **no spaces in the path**, ~25 GB free, and Internet access. Debian 11+ on amd64 is the usual host.

```bash
# Dependencies (Debian/Ubuntu) — or use ImmortalWrt’s init script:
#   sudo bash -c 'bash <(curl -s https://build-scripts.immortalwrt.org/init_build_environment.sh)'

git clone https://github.com/T-REX-XP/immortalwrt.git
cd immortalwrt

./scripts/feeds update -a
./scripts/feeds install -a

make menuconfig
# Target System → Rockchip
# Subtarget → RK33xx/RK35xx boards (64 bit)
# Target Profile → Xunlong Orange Pi CM5 Base  (default in this fork)

make -j$(nproc) V=s
```

Images appear under `bin/targets/rockchip/armv8/`.

Point `feeds.conf` / build scripts at your local **`openwrt-packages`** checkout so `luci-app-oled`, `luci-app-mcu-display`, `luci-app-peripherals`, and `cm5-button-scripts` resolve at compile time.

### macOS

Do **not** run `make` on the Mac host. Use the Docker wrapper in the sibling `build_immortalwrt` project (see that repo’s README / `AGENTS.md`), for example:

```bash
./scripts/build-immortalwrt-macos.sh \
  --source /path/to/immortalwrt \
  --device xunlong_orangepi-cm5-base
```

---

## Repository map

| Path / repo | What it is |
|-------------|------------|
| `target/linux/rockchip/` | Kernel 6.18 patches, CM5 DTS, image profile, bootscript |
| `target/linux/rockchip/armv8/base-files/` | First-boot network, LEDs, Wi-Fi, apk-feed cleanup |
| [`openwrt-packages`](../openwrt-packages) | Custom feed: OLED, MCU display, peripherals, button scripts, … |
| `immortal_opi_cm5` | DTS source of truth & patch export workflow |
| `build_immortalwrt` | macOS → Docker build wrapper |

Contributor-oriented notes for agents and maintainers live in [`AGENTS.md`](AGENTS.md).

---

## Contributing

Issues and pull requests focused on CM5 Base are welcome:

- Prefer `board_name` / device guards so other Rockchip armv8 boards keep working
- Put new daemons and LuCI apps in **openwrt-packages**, then list them in `DEVICE_PACKAGES` here
- Kernel/DTS changes → `patches-6.18/` (or export from `immortal_opi_cm5`)
- Runtime / first-boot behavior → `armv8/base-files/`

Upstream ImmortalWrt / OpenWrt docs remain the reference for the generic build system:

- [Build system setup](https://openwrt.org/docs/guide-developer/build-system/install-buildsystem)
- [User guide](https://openwrt.org/docs/guide-user/start)
- [ImmortalWrt Firmware Selector](https://firmware-selector.immortalwrt.org/) (stock ImmortalWrt images — not this fork’s CM5 defaults)

Community chat for stock ImmortalWrt: [Telegram](https://t.me/ctcgfw_openwrt_discuss) · [Matrix](https://matrix.to/#/#immortalwrt:matrix.org)

---

## License & credits

- This tree inherits ImmortalWrt / OpenWrt licensing — primarily **[GPL-2.0-only](https://spdx.org/licenses/GPL-2.0-only.html)** for the build system and kernel packaging.
- Based on [ImmortalWrt](https://github.com/immortalwrt/immortalwrt) and [OpenWrt](https://openwrt.org).
- Orange Pi CM5 Base work is maintained in this fork for the community; hardware trademarks belong to their respective owners.

Thanks to the ImmortalWrt and OpenWrt communities, and to everyone testing CM5 images, OLED HATs, and USB Wi-Fi sticks in the wild.
