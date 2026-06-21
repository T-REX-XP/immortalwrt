# Orange Pi CM5 Base — MT76x2u hotspot optimization report

*Investigation of the CM5 ImmortalWrt image USB Wi-Fi stack (`kmod-mt76x2u`) and plan to improve access-point performance. Last updated: 2026-06-20.*

## Implementation status

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase 1** — defaults & driver | **Completed** | `51-mt76x2u-ap`, `cm5-base-wifi.sh`, `03_wireless_cm5`, randomized PSK |
| **Phase 2** — platform & hostapd | **Completed** | xHCI IRQ affinity, `sae-mixed`, `disassoc_low_ack=0` |
| **Phase 3** — LuCI & diagnostics | **Partial** | `cm5-wifi-benchmark` script; LuCI panel deferred |
| **Phase 4** — advanced | **Deferred** | ACS tuning, DFS upstream, mesh |

**Shipped defaults (first boot):** 5 GHz **VHT80**, ACS on non-DFS chanlist `36-48 149-165`, WPA3 transition (`sae-mixed`), random PSK in `/etc/credentials/cm5-wifi-ap`, secondary 2.4 GHz radio disabled when 5 GHz is present, `disable_usb_sg=1` for mt76x2u.

**Verify on device:** `cm5-wifi-benchmark` · `uci show wireless` · `iw dev` · plug dongle into **USB 3.0** port (`lsusb -t`).

## Executive summary

The CM5 Base image ships **`kmod-mt76x2u`** (MediaTek **MT7612U**, 802.11ac 2×2 MIMO USB) plus **`wpad-openssl`**, **`hostapd-utils`**, and **`wireless-regdb`**. Runtime AP setup is handled by **`/lib/cm5-base-wifi.sh`**, triggered from USB/ieee80211 hotplug and a boot retry in **`reload-sdio-wifi`**.

**Implemented (2026-06-20):** Phase 1–2 are in the image. First boot configures a **5 GHz VHT80** AP with **`disable_usb_sg=1`**, **WPA3 transition**, random PSK, and xHCI IRQ affinity. Run **`cm5-wifi-benchmark`** on the router to validate. Phase 3 LuCI panel and Phase 4 advanced items remain optional follow-ups.

---

## 1. Hardware: MT7612U / `kmod-mt76x2u`

| Property | Detail |
|----------|--------|
| Chipset | MediaTek MT7612U (marketed as “MT76x2u”) |
| Driver | In-tree **`mt76x2u`** (`package/kernel/mt76`, `kmod-mt76x2u`) |
| USB ID (runtime) | Typically **`0e8d:7612`** after modeswitch |
| Installer mode | **`0e8d:2870`** CD-ROM — handled by `usbmode` + boot quirk |
| 802.11 | a/b/g/n/ac (Wave 1 VHT) |
| MIMO | **2×2** (VHT-MCS 0–9) |
| Best band | **5 GHz** — VHT80 up to **866.7 Mbps** link rate (2 SS, short GI) |
| 2.4 GHz | HT40 up to ~300 Mbps link rate |
| USB | **USB 3.0 strongly recommended** — USB 2.0 caps real throughput |
| Firmware | `mt7662u.bin`, `mt7662u_rom_patch.bin` (symlinked in package install) |
| AP mode | Supported in mainline mt76 (OpenWrt uses mac80211 + hostapd) |

### Known driver constraints (community / upstream)

1. **`disable_usb_sg`** — USB scatter-gather can cause **severe throughput loss or instability** on 5 GHz AP over USB 3.0. Setting **`disable_usb_sg=1`** on `mt76x2u` (or `mt76_usb`) is widely recommended for AP use; little upside from SG when enabled.
2. **DFS** — 5 GHz AP on DFS channels has historically been problematic on mt7612u; prefer **non-DFS** channels (e.g. **36–48**, **149–165**) unless ACS + regdom is validated.
3. **Single PHY, dual band** — one radio; 2.4 and 5 GHz are not fully concurrent on one chip instance. OpenWrt may expose one or two `wifi-device` sections depending on `wifi config` / band split — design for **one primary 5 GHz AP**.
4. **Encryption cost** — WPA3-SAE handshake can be CPU-heavy on slow hosts; CM5 (RK3588S) is fine, but **`cell_density`** and distance still affect association (see mt76 GitHub issues on “6 Mbit/s” symptom).

---

## 2. Image integration (current)

### 2.1 Packages (`target/linux/rockchip/image/armv8.mk`)

Relevant `DEVICE_PACKAGES` entries for `xunlong_orangepi-cm5-base`:

```text
kmod-mt76x2u kmod-rtl8812au-ct wpad-openssl hostapd-utils wireless-regdb
usb-modeswitch usbutils
```

Also present: `travelmate`, `luci-app-travelmate`, `pbr`, `sqm-scripts` — useful for **WAN** path, not AP tuning unless WAN is the bottleneck.

**Note:** **`kmod-rtl8812au-ct`** is a second USB Wi-Fi stack (out-of-tree). Avoid using two USB Wi-Fi dongles simultaneously without careful IRQ/USB planning.

### 2.2 Boot / USB bring-up

| Component | Role |
|-----------|------|
| `996-*-vbus-startup-delay.patch` | `startup-delay-us = <150000>` on `vbus_5v0` — stabilizes early USB power |
| `orangepi-cm5-base.bootscript` | `usb-storage.quirks=0e8d:2870:i` — ignore installer CD-ROM |
| `91-usbmodeswitch-cm5-firstboot` | Background `usbmodeswitch-cm5-run boot-loop` |
| `55-usbmodeswitch-cm5` | Hotplug-triggered modeswitch |
| `usbmodeswitch-cm5-run` | Detects `0e8d:2870` / `7612` / wiphy on USB |

### 2.3 Wireless autoconfig (`lib/cm5-base-wifi.sh`)

Triggered by:

- `etc/hotplug.d/ieee80211/30-cm5-usb-wifi-ap` (3 s delay after phy add)
- `etc/init.d/reload-sdio-wifi` (25 s boot retry for CM5)
- `etc/uci-defaults/94-cm5-second-wifi-config` (LuCI placeholder + early `wifi config`)

**What `cm5_autoconfig_hotspot()` does today:**

```sh
wifi config
# For each real wifi-device:
#   country='US'
#   wifi-iface: mode=ap, network=lan, ssid='ImmortalWrt-CM5',
#               encryption='psk2', key='immortalwrt-cm5'
# Does NOT set: band, channel, htmode, cell_density, txpower
```

**Gap vs. OpenWrt defaults:** `mac80211.uc` (run by `wifi config`) *would* set **`band`**, **`channel`**, and **`htmode`** (e.g. `VHT80` on 5G) **when creating new** `wifi-device` entries from `board.json`. CM5 has **no `board.json` wlan defaults**, and `cm5_autoconfig_hotspot` only adds/updates the **iface** — it may leave radios at **placeholder or minimal** settings from first `wifi config` timing.

### 2.4 Platform tuning already present

| Item | CM5 status |
|------|------------|
| Ethernet IRQ affinity | **Yes** — `40-net-smp-affinity` pins eth0/1/2 |
| USB/xHCI IRQ affinity | **Yes** — `40-net-smp-affinity` pins `xhci-hcd` on CM5 |
| `mt76x2u` module options | **`/etc/modules.d/51-mt76x2u-ap`** (`disable_usb_sg=1`) |
| `board.json` wlan defaults | **`etc/board.d/03_wireless_cm5`** |
| WPA3 / SAE | **`sae-mixed`** on first AP setup |
| 5 GHz preferred AP | **Enforced** in `cm5-base-wifi.sh` |

### 2.5 USB topology (DTS)

CM5 Base enables **`usb_host0_xhci`** (host mode) plus EHCI/OHCI and **`u2phy2_host`**. Plug the MT7612U dongle into the **USB 3.0 (blue) host port** on the carrier; verify with `lsusb -t` that the device runs under **`xhci-hcd`**, not **`ehci-hcd`**.

---

## 3. Gap analysis

| Area | Current | Impact |
|------|---------|--------|
| Band / width | Not forced to 5G VHT80 | Often stays 2.4G HT20 → **low speed** |
| Channel | Unspecified / auto-low | Suboptimal or congested channel |
| Country | Hard-coded `US` | May be wrong for user; affects power/channels |
| Security | Fixed WPA2 PSK | Weak default password; no WPA3 option |
| USB SG | Default on | **Major 5 GHz AP throughput risk** |
| USB IRQ | Not pinned | Latency jitter under CPU load |
| LuCI placeholder | `cm5_placeholder` hack | Needed for menu; should be replaced with real tuned radio |
| Dual driver | rtl8812au + mt76 | User confusion if wrong dongle/driver loaded |
| Testing | No image-level Wi-Fi benchmark | Regressions unnoticed |

---

## 4. Optimization recommendations

### Tier A — High impact, low risk (implement first)

#### A1. Smart radio defaults in `cm5-base-wifi.sh`

After `wifi config`, for each managed `wifi-device`:

1. Detect band from UCI or phy (`iw phy phyN info`).
2. **Prefer 5 GHz** for the primary AP:
   - `band='5g'`
   - `htmode='VHT80'` (fallback `VHT40` if 80 MHz rejected)
   - `channel='auto'` with **`chanlist='36-48 149-165'`** (non-DFS bias)
3. Set **`cell_density='1'`** (normal) — helps avoid legacy 1 Mbps basic rates that confuse some clients.
4. Keep 2.4 GHz radio **disabled** unless user enables guest network in LuCI.

Pseudo-logic:

```sh
# 5g primary AP
set wireless.$radio.band='5g'
set wireless.$radio.htmode='VHT80'
set wireless.$radio.channel='auto'
set wireless.$radio.chanlist='36-48 149-165'
set wireless.$radio.cell_density='1'
set wireless.$radio.country='ES'   # or from /etc/device_info / uci system
```

#### A2. Module parameter: disable USB scatter-gather

Add **`/etc/modules.d/mt76x2u`** (or `51-mt76x2u-usb-ap`):

```text
options mt76x2u disable_usb_sg=1
```

Optionally also:

```text
options mt76_usb disable_usb_sg=1
```

Rebuild not required — base-files only.

#### A3. `board.json` wlan defaults (board.d)

Add **`etc/board.d/03_wireless_cm5`** (or extend existing board.d) with:

```sh
ucidef_set_wireless_mac_count 1
# Prefer 5g defaults for first SSID — exact API depends on ImmortalWrt ucidef helpers
```

Align with ImmortalWrt’s `board.json` → `mac80211.uc` path so **`wifi config`** creates optimal devices **before** `cm5_autoconfig_hotspot` runs.

#### A4. First-boot SSID / key

Replace static `immortalwrt-cm5` with:

- SSID: `ImmortalWrt-CM5-<last4 MAC>` or serial suffix
- Key: random 16+ char from `/dev/urandom`, logged once to `/etc/credentials/wifi` or LuCI banner

---

### Tier B — Platform & hostapd tuning

#### B1. USB / xHCI interrupt affinity

Extend **`40-net-smp-affinity`** for `xunlong,orangepi-cm5-base`:

- Pin **xHCI** IRQ to a little-used core (e.g. mask `8` on CPU3)
- On `ACTION=add` for USB Wi-Fi netdev, optionally pin USB endpoint IRQ

Validate with `/proc/interrupts` while running `iperf3`.

#### B2. hostapd / UCI iface options

On primary AP iface:

| Option | Suggested | Reason |
|--------|-----------|--------|
| `encryption` | `sae-mixed` or `psk2+ccmp` | WPA3 transition where clients support it (`wpad-openssl`) |
| `ieee80211k` / `ieee80211v` | `1` if supported | Better roaming (less critical for single AP) |
| `disassoc_low_ack` | `0` on USB AP if clients drop | mt76 issue threads mention sticky clients |
| `beacon_int` | `100` (default) | Only raise if many clients |
| `skip_inactivity_poll` | `0` | Default |

Enable **`log_level`** temporarily (`'2'`) during field debug.

#### B3. Regulatory domain

Use **`wireless-regdb`** properly:

- Default country from **`/etc/banner`** locale or **`/etc/config/system`** `@system[0].hostname`** / user UCI
- Document that **`iw reg get`** must show intended country after boot

#### B4. SQM / offload

Image includes **`sqm-scripts`**. Enable **only if WAN is bottleneck**; Wi-Fi AP tuning does not replace fair-queue on 2.5 GbE WAN.

---

### Tier C — UX, dual-band strategy, LuCI

#### C1. LuCI Network → Wireless

Ensure removal of **`cm5_placeholder`** leaves a visible, fully configured 5 GHz AP with HT mode shown as **80 MHz**.

Optional: **`luci-app-peripherals`** or new **`luci-app-cm5-wifi`** section:

- Dongle detected (USB ID, driver, USB generation)
- Link rate / MCS (from `iw dev … station dump`)
- One-click “Optimize for speed” (applies Tier A UCI)

#### C2. Single-band AP policy

Document: **one AP on 5 GHz** for performance. Optional second **`wifi-iface`** on 2.4 GHz for IoT (`htmode='HT20'`, fixed channel 1/6/11) — user opt-in only.

#### C3. WPS button integration

`95-cm5-buttons` / `cm5-button-scripts` already call **`hostapd_cli wps_pbc`**. Ensure WPS runs on the **5 GHz AP iface** (not placeholder).

---

### Tier D — Validation & monitoring

#### D1. Bundled test script (`/usr/libexec/cm5-wifi-benchmark`)

```sh
# Preconditions: AP up, client associated
iw dev <ifname> info
iw dev <ifname> station dump
iperf3 -s &   # on router
# Client: iperf3 -c 192.168.8.1 -R -t 30
```

Record: **TX/RX bitrate**, **MCS**, **channel width**, **USB bus** (`lsusb -t`).

#### D2. Acceptance targets (realistic)

| Metric | Target (5 GHz, same room) |
|--------|---------------------------|
| Link rate | ≥ **400 Mbps** (VHT-MCS 7–9, 80 MHz, 2 SS) |
| TCP iperf (LAN) | ≥ **250 Mbps** one direction |
| Association time | < 5 s after hotplug |
| Stability | 24 h AP, no hostapd restart loop |

Theoretical **866 Mbps** is link-layer; TCP often lands **350–550 Mbps** on good USB3 AP setups.

---

## 5. Implementation plan

### Phase 1 — Defaults & driver (1–2 days) ✅ Completed

| Step | File(s) | Change |
|------|---------|--------|
| 1.1 | `armv8/base-files/etc/modules.d/51-mt76x2u-ap` | `options mt76x2u disable_usb_sg=1` |
| 1.2 | `armv8/base-files/lib/cm5-base-wifi.sh` | Band/htmode/channel/chanlist/cell_density; 5G preference |
| 1.3 | `armv8/base-files/etc/board.d/03_wireless_cm5` | `board.json` wlan defaults for `wifi config` |
| 1.4 | `armv8/base-files/lib/cm5-base-wifi.sh` | Randomized PSK; `/etc/credentials/cm5-wifi-ap` |
| 1.5 | ` build_immortalwrt/README.md` | Wi-Fi AP section (see below) |

**Test:** Flash image, plug MT7612U in USB3, verify `uci show wireless`, `iw phy`, client speedtest.

### Phase 2 — Platform tuning (1 day) ✅ Completed

| Step | File(s) | Change |
|------|---------|--------|
| 2.1 | `etc/hotplug.d/net/40-net-smp-affinity` | xHCI IRQ mask for CM5 |
| 2.2 | `cm5-base-wifi.sh` | 5 GHz tuning via UCI (`cell_density`, chanlist) |
| 2.3 | `wifi-iface` UCI | `sae-mixed`, `disassoc_low_ack=0` |

**Test:** `iperf3` before/after; `cat /proc/interrupts` under load.

### Phase 3 — LuCI & ops (2–3 days) ⏳ Partial

| Step | File(s) | Change |
|------|---------|--------|
| 3.1 | `openwrt-packages/.../luci-app-peripherals` or new app | Status panel: USB gen, driver, MCS, channel width — **deferred** |
| 3.2 | `docs/cm5-mt76x2u-hotspot-optimization.md` | This document |
| 3.3 | `usr/libexec/cm5-wifi-benchmark` | ✅ Diagnostic script |

### Phase 4 — Advanced (optional) ⏸ Deferred

- Enable **hostapd ACS** with dwell limits on non-DFS set only
- Evaluate **802.11ac probe** with second USB Wi-Fi removed from default image if unused
- Upstream: track mt76 **DFS AP** patches for future kernel bumps
- **Mesh / 802.11s** — possible on MT7612U but separate scope; not recommended on same USB bus as primary AP

---

## 6. Recommended UCI reference (post Phase 1)

Example target configuration for primary 5 GHz AP:

```text
config wifi-device 'radio0'
	option type 'mac80211'
	option path '…usb…/1-1…'
	option band '5g'
	option channel 'auto'
	option chanlist '36-48 149-165'
	option htmode 'VHT80'
	option country 'US'
	option cell_density '1'

config wifi-iface 'default_radio0'
	option device 'radio0'
	option network 'lan'
	option mode 'ap'
	option ssid 'ImmortalWrt-CM5-xxxx'
	option encryption 'psk2'
	option key '<random>'
```

After Phase 2, consider `encryption 'sae-mixed'`.

---

## 7. Troubleshooting checklist

| Symptom | Check |
|---------|--------|
| No wireless in LuCI | `cm5_placeholder` vs real phy; run `wifi config` |
| Dongle not detected | `lsusb`, `usbmodeswitch-cm5-run`, VBUS delay, USB port power |
| Installer `0e8d:2870` | `usbmode -s`, boot quirk present |
| ~6 Mbps or instant disconnect | `cell_density`, encryption, `logread -f`, try `disassoc_low_ack=0` |
| Low throughput on 5G | `disable_usb_sg=1`, USB3 port, channel 149/36, VHT80 in `uci` |
| DNS works on eth, not Wi-Fi | LAN bridge / firewall — separate from Wi-Fi tuning (see Blocky README) |

---

## 8. References

### In-tree

- `target/linux/rockchip/image/armv8.mk` — `DEVICE_PACKAGES`
- `target/linux/rockchip/armv8/base-files/lib/cm5-base-wifi.sh`
- `target/linux/rockchip/armv8/base-files/etc/hotplug.d/ieee80211/30-cm5-usb-wifi-ap`
- `target/linux/rockchip/armv8/base-files/etc/init.d/reload-sdio-wifi`
- `target/linux/rockchip/armv8/base-files/usr/sbin/usbmodeswitch-cm5-run`
- `package/kernel/mt76/Makefile` — `kmod-mt76x2u`
- `package/network/config/wifi-scripts/files/lib/wifi/mac80211.uc`

### External

- [openwrt/mt76 — MT7612U AP discussions](https://github.com/openwrt/mt76/issues/409)
- [morrownr/7612u — AP guide, `disable_usb_sg`](https://github.com/morrownr/7612u)
- [OpenWrt wireless configuration](https://openwrt.org/docs/guide-user/network/wifi/basic)

---

## 9. Summary priority matrix

| Priority | Item | Effort | Speed gain |
|----------|------|--------|------------|
| P0 | 5 GHz + VHT80 + non-DFS chanlist | Low | **Very high** |
| P0 | `disable_usb_sg=1` | Low | **High** (stability + throughput) |
| P1 | USB3 port verification + docs | Low | High (avoid USB2 cap) |
| P1 | Random PSK / SSID | Low | Security (not throughput) |
| P2 | USB IRQ affinity | Medium | Medium |
| P2 | WPA3 sae-mixed | Low | Security |
| P3 | LuCI diagnostics page | Medium | Operability |
| P3 | iperf benchmark script | Low | Regression testing |

Implement **P0 + P1** in Phase 1 for maximum wireless improvement with minimal risk.
