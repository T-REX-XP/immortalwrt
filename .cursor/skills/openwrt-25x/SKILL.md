---
name: openwrt-25x
description: >-
  OpenWrt / ImmortalWrt 25.x build conventions in this tree: apk instead of
  opkg/.ipk, default 25.x kernel 6.12 vs this CM5 rockchip KERNEL_PATCHVER 6.18,
  and ucode LuCI in the sibling feed. Use when editing target Makefiles, package
  index/QA, install commands, or when the user mentions OpenWrt 25, apk, opkg,
  kernel 6.12, or 6.18.
---

# OpenWrt 25.x in this ImmortalWrt fork

## apk

Firmware and `package/index` are **apk**. On a flashed router:

```sh
apk update
apk add <pkg>
apk info <pkg>
```

Never `opkg` / `.ipk`.

## Kernel — do not “standardize” rockchip to 6.12

| Tree | Kernel |
|------|--------|
| OpenWrt 25.x typical targets | **6.12** |
| This repo `target/linux/rockchip` (CM5) | **`KERNEL_PATCHVER:=6.18`** |

Keep `patches-6.18/` and CM5 DTS patches. Skill **`rockchip-kernel-dts`**.

## LuCI / ucode

App RPC lives in **openwrt-packages** (`rpcd-mod-ucode`, `ucode-mod-uci`, `ucode-mod-fs`). Verify with `ucode -c` on the router. Skill **`openwrt-25x`** there.

## Related

- **`immortalwrt-build-system`** — `make world` / feeds
- **`rockchip-cm5-target`** — device profile
