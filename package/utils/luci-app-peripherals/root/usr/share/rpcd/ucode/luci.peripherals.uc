#!/usr/bin/env ucode

'use strict';

import { readfile, writefile, popen, lsdir, basename, access } from 'fs';

const BTN_DIR = '/etc/rc.button';
const RC_MAPS = '/etc/rc_maps.cfg';
const RC_KEYMAPS = '/etc/rc_keymaps';
const IR_KEYTABLE = '/usr/bin/ir-keytable';
const MAX_SCRIPT = 131072;

const UCI_PKG = 'luci_peripherals';
const UCI_SEC = 'peripherals';

/* Names as in /proc/modules or /sys/module/<name> (underscores). */
const DIAG_MODULES = [
	{ module: 'rc_core', label: 'RC core (kmod-multimedia-input)', optional: false },
	{ module: 'gpio_ir_recv', label: 'GPIO IR receiver (kmod-ir-gpio-cir)', optional: false },
	{ module: 'pwm_fan', label: 'PWM fan hwmon (kmod-hwmon-pwmfan)', optional: true },
	{ module: 'gpio_button_hotplug', label: 'GPIO button hotplug (/etc/rc.button)', optional: true },
	{ module: 'gpio_keys', label: 'GPIO keys (polled)', optional: true }
];

function uci_get_opt(option, def) {
	let p = popen(`uci -q get ${UCI_PKG}.${UCI_SEC}.${option} 2>/dev/null`, 'r');
	let v = trim(p ? (p.read('all') || '') : '');
	if (p)
		p.close();
	return length(v) ? v : def;
}

function uci_set_opt(option, value) {
	if (!match(option, /^[a-z_]+$/))
		return;
	let val = `${value}`;
	if (!match(val, /^[0-9a-zA-Z_-]+$/))
		return;
	let p = popen(`uci set ${UCI_PKG}.${UCI_SEC}.${option}=${val} && uci commit ${UCI_PKG} 2>&1`, 'r');
	if (p) {
		p.read('all');
		p.close();
	}
}

function uname_release() {
	let p = popen('uname -r 2>/dev/null', 'r');
	const raw = trim(p ? (p.read('all') || '') : '');
	if (p)
		p.close();
	return raw;
}

/* Prefer uname -r; if empty, use a single versioned tree under /lib/modules (kernel/rootfs skew diagnostics). */
function kernel_release_for_modules() {
	let ur = uname_release();
	if (length(ur))
		return ur;
	try {
		let list = lsdir('/lib/modules');
		let fallback = '';
		for (let i = 0; i < length(list); i++) {
			let n = list[i];
			if (!length(n) || n == '.' || n == '..')
				continue;
			if (access(`/lib/modules/${n}/modules.dep`))
				return n;
			if (!length(fallback))
				fallback = n;
		}
		return fallback;
	} catch (e) {}
	return '';
}

function proc_modules_set() {
	let set = {};
	let count = 0;
	try {
		const t = readfile('/proc/modules');
		const lines = split(t, '\n');
		for (let i = 0; i < length(lines); i++) {
			const line = trim(lines[i]);
			if (!length(line))
				continue;
			const parts = split(line, /\s+/, 2);
			if (length(parts) > 0) {
				set[parts[0]] = true;
				count++;
			}
		}
	} catch (e) {}
	return { set, count };
}

function module_state(name, procset) {
	if (procset[name])
		return 'loaded';
	if (access(`/sys/module/${name}`))
		return 'builtin';
	return 'missing';
}

function find_fan_hwmon() {
	try {
		let list = lsdir('/sys/class/hwmon');
		for (let i = 0; i < length(list); i++) {
			let h = list[i];
			if (!match(h, /^hwmon[0-9]+$/))
				continue;
			let p = `/sys/class/hwmon/${h}`;
			try {
				if (trim(readfile(`${p}/name`)) == 'pwmfan')
					return p;
			} catch (e) {}
		}
	} catch (e) {}
	return null;
}

function list_hwmon() {
	let items = [];
	try {
		let list = lsdir('/sys/class/hwmon');
		for (let i = 0; i < length(list); i++) {
			let h = list[i];
			if (!match(h, /^hwmon[0-9]+$/))
				continue;
			let name = '';
			try {
				name = trim(readfile(`/sys/class/hwmon/${h}/name`));
			} catch (e) {}
			push(items, { id: h, name, path: `/sys/class/hwmon/${h}` });
		}
	} catch (e) {}
	return items;
}

function dt_has_pwm_fan() {
	try {
		let compat = readfile('/proc/device-tree/fan/compatible');
		return !!match(compat, /pwm-fan/);
	} catch (e) {}
	try {
		let compat = readfile('/proc/device-tree/pwm-fan/compatible');
		return !!match(compat, /pwm-fan/);
	} catch (e) {}
	return false;
}

function device_tree_model() {
	try {
		return trim(readfile('/proc/device-tree/model'));
	} catch (e) {}
	return '';
}

function fan_board_info() {
	return {
		board: 'Orange Pi CM5 Base',
		manual: 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3',
		connector: '5V 2-pin 1.25mm fan socket',
		control: 'PWM speed and switch control',
		dts_node: '/fan compatible=pwm-fan',
		pwm: 'PWM3, pinctrl pwm3m1_pins',
		period_ns: 10000,
		hwmon_name: 'pwmfan',
		tachometer: 'not exposed by the 2-pin connector',
		enable_modes: {
			'0': 'hard off: PWM disabled and fan supply disabled',
			'1': 'automatic/thermal: PWM disabled at idle, supply kept enabled',
			'2': 'manual PWM: PWM enabled and fan supply enabled',
			'3': 'off with supply disabled when idle'
		}
	};
}

function fan_diag(base, procset) {
	const mod_r = kernel_release_for_modules();
	const lib_path = length(mod_r) ? `/lib/modules/${mod_r}` : '/lib/modules';
	return {
		hwmon: list_hwmon(),
		module_state: module_state('pwm_fan', procset),
		module_file: !!access(`${lib_path}/pwm-fan.ko`),
		autoload: !!access('/etc/modules.d/60-hwmon-pwmfan'),
		dt_pwm_fan: dt_has_pwm_fan(),
		device_tree_model: device_tree_model(),
		path: base || '',
		board_info: fan_board_info()
	};
}

function clamp_pwm(v) {
	let s = trim(`${v}`);
	let n = 0;
	if (match(s, /^[0-9]+$/))
		n = +s;
	else
		n = 192;
	if (n < 0)
		n = 0;
	if (n > 255)
		n = 255;
	return n;
}

/* pwm-fan hwmon: 0 hard-off, 1 automatic/thermal idle, 2 manual PWM. */
function fan_apply_hw(base, mode, pwmval) {
	if (!base)
		return { error: 'no_fan' };
	if (mode == 'off') {
		try {
			if (access(`${base}/pwm1_enable`))
				writefile(`${base}/pwm1_enable`, '0\n');
		} catch (e) {
			return { error: 'fan_off', message: `${e}` };
		}
		return { ok: true };
	}
	if (mode == 'manual') {
		try {
			if (access(`${base}/pwm1_enable`))
				writefile(`${base}/pwm1_enable`, '2\n');
			writefile(`${base}/pwm1`, `${pwmval}\n`);
		} catch (e) {
			return { error: 'fan_manual', message: `${e}` };
		}
		return { ok: true };
	}
	try {
		if (access(`${base}/pwm1_enable`))
			writefile(`${base}/pwm1_enable`, '1\n');
	} catch (e) {
		return { error: 'fan_auto', message: `${e}` };
	}
	return { ok: true };
}

function append_line(lines, text) {
	push(lines, text != null ? `${text}` : '');
}

function append_block(lines, title, body) {
	append_line(lines, '');
	append_line(lines, `## ${title}`);
	append_line(lines, length(trim(body || '')) ? trim(body) : '(empty)');
}

function read_optional(path) {
	try {
		return trim(readfile(path));
	} catch (e) {}
	return '';
}

function run_cmd(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return 'popen failed';
	let out = p.read('all') || '';
	let code = p.close();
	if (code != 0 && !length(trim(out)))
		out = `exit code ${code}`;
	return trim(out);
}

function debug_report() {
	const pm = proc_modules_set();
	const base = find_fan_hwmon();
	let lines = [];

	append_line(lines, 'Orange Pi CM5 Base peripheral debug report');
	append_line(lines, 'Generated by luci-app-peripherals.');
	append_line(lines, 'This report is read-only; no GPIO/PWM/button state was changed.');

	append_block(lines, 'System', run_cmd('date; uname -a; uptime; cat /etc/openwrt_release 2>/dev/null'));
	append_block(lines, 'Device tree model', `${device_tree_model() || '(unknown)'}\ncompatible=${run_cmd("tr '\\0' ' ' </proc/device-tree/compatible")}`);
	append_block(lines, 'Board fan reference', sprintf(
		'board=%s\nmanual=%s\nconnector=%s\ncontrol=%s\ndts=%s\npwm=%s\nperiod_ns=%d\ntachometer=%s',
		fan_board_info().board,
		fan_board_info().manual,
		fan_board_info().connector,
		fan_board_info().control,
		fan_board_info().dts_node,
		fan_board_info().pwm,
		fan_board_info().period_ns,
		fan_board_info().tachometer
	));

	append_block(lines, 'UCI peripherals config', run_cmd(`uci -q show ${UCI_PKG}`));
	append_block(lines, 'Button scripts', run_cmd(`ls -la ${BTN_DIR}; for f in ${BTN_DIR}/*; do [ -f "$f" ] || continue; echo "--- $f"; sed -n '1,120p' "$f"; done`));
	append_block(lines, 'Button and key modules', sprintf(
		'gpio_button_hotplug=%s\ngpio_keys=%s\n/proc/modules count=%d',
		module_state('gpio_button_hotplug', pm.set),
		module_state('gpio_keys', pm.set),
		pm.count
	));
	append_block(lines, 'GPIO key device tree hints', run_cmd("for d in /proc/device-tree/gpio-keys* /proc/device-tree/*/gpio-keys*; do [ -e \"$d\" ] || continue; echo \"--- $d\"; find \"$d\" -maxdepth 2 -type f -print 2>/dev/null | while read f; do printf '%s=' \"$f\"; tr '\\0' ' ' <\"$f\" 2>/dev/null; echo; done; done"));

	append_block(lines, 'Fan hwmon state', sprintf(
		'present=%s\npath=%s\npwm1=%s\npwm1_enable=%s\nfan1_input=%s\ndt_pwm_fan=%s\nmodule_state=%s\nautoload=%s',
		base ? 'yes' : 'no',
		base || '',
		base ? read_optional(`${base}/pwm1`) : '',
		base ? read_optional(`${base}/pwm1_enable`) : '',
		base ? read_optional(`${base}/fan1_input`) : '',
		dt_has_pwm_fan() ? 'yes' : 'no',
		module_state('pwm_fan', pm.set),
		access('/etc/modules.d/60-hwmon-pwmfan') ? 'yes' : 'no'
	));
	append_block(lines, 'All hwmon devices', run_cmd("for d in /sys/class/hwmon/hwmon*; do [ -e \"$d\" ] || continue; printf '%s name=' \"$d\"; cat \"$d/name\" 2>/dev/null; for f in \"$d\"/pwm* \"$d\"/fan*_input \"$d\"/temp*_input; do [ -e \"$f\" ] && printf '  %s=%s\\n' \"$f\" \"$(cat \"$f\" 2>/dev/null)\"; done; done"));
	append_block(lines, 'Thermal zones', run_cmd("for z in /sys/class/thermal/thermal_zone*; do [ -e \"$z\" ] || continue; printf '%s type=%s temp=%s\\n' \"$z\" \"$(cat \"$z/type\" 2>/dev/null)\" \"$(cat \"$z/temp\" 2>/dev/null)\"; done"));
	append_block(lines, 'Kernel PWM debug', run_cmd("cat /sys/kernel/debug/pwm 2>/dev/null || echo 'debugfs PWM information unavailable; mount debugfs or enable kernel debugfs to inspect raw PWM state'"));

	append_block(lines, 'IR devices', run_cmd("ls -la /sys/class/rc 2>/dev/null; for d in /sys/class/rc/rc*; do [ -e \"$d\" ] || continue; echo \"--- $d\"; cat \"$d/uevent\" 2>/dev/null; done; [ -x /usr/bin/ir-keytable ] && /usr/bin/ir-keytable 2>&1 || true"));
	append_block(lines, 'IR maps', run_cmd(`ls -la ${RC_KEYMAPS} 2>/dev/null; echo '--- rc_maps.cfg'; sed -n '1,160p' ${RC_MAPS} 2>/dev/null`));

	append_block(lines, 'Relevant kernel log', run_cmd("dmesg | grep -Ei 'pwm|fan|thermal|gpio|button|keys|ir|rc-core|r8125|eth|gmac' | tail -n 160"));
	append_block(lines, 'Relevant system log', run_cmd("logread 2>/dev/null | grep -Ei 'button|gpio|fan|pwm|thermal|ir|rc-core|peripheral' | tail -n 160 || true"));

	return join('\n', lines);
}

function safe_btn_name(name) {
	return type(name) == 'string' && length(name) <= 64 && match(name, /^[a-zA-Z0-9._-]+$/);
}

const methods = {
	buttonList: {
		call: function() {
			let names = [];
			try {
				const list = lsdir(BTN_DIR);
				for (let i = 0; i < length(list); i++) {
					const n = list[i];
					if (safe_btn_name(n))
						push(names, n);
				}
			} catch (e) {
				return { names: [], error: 'no_button_dir' };
			}
			sort(names);
			return { names };
		}
	},

	buttonGet: {
		args: { name: 'name' },
		call: function(req) {
			const name = req.args?.name;
			if (!safe_btn_name(name))
				return { error: 'invalid_name' };
			let content = '';
			try {
				content = readfile(`${BTN_DIR}/${name}`);
			} catch (e) {
				return { error: 'read_failed', message: `${e}` };
			}
			return { name, content };
		}
	},

	buttonSet: {
		args: { name: 'name', content: 'content' },
		call: function(req) {
			const name = req.args?.name;
			const content = req.args?.content;
			if (!safe_btn_name(name))
				return { error: 'invalid_name' };
			if (type(content) != 'string' || length(content) > MAX_SCRIPT)
				return { error: 'invalid_content' };
			try {
				writefile(`${BTN_DIR}/${name}`, content);
			} catch (e) {
				return { error: 'write_failed', message: `${e}` };
			}
			return { ok: true, name };
		}
	},

	irMapsGet: {
		call: function() {
			try {
				return { content: readfile(RC_MAPS) };
			} catch (e) {
				return { content: '', missing: true };
			}
		}
	},

	irMapsSet: {
		args: { content: 'content' },
		call: function(req) {
			const content = req.args?.content;
			if (type(content) != 'string' || length(content) > MAX_SCRIPT)
				return { error: 'invalid_content' };
			try {
				writefile(RC_MAPS, content);
			} catch (e) {
				return { error: 'write_failed', message: `${e}` };
			}
			return { ok: true };
		}
	},

	irKeymapsList: {
		call: function() {
			let files = [];
			try {
				const list = lsdir(RC_KEYMAPS);
				for (let i = 0; i < length(list); i++)
					push(files, list[i]);
				sort(files);
			} catch (e) {
				return { files: [], missing: true };
			}
			return { files };
		}
	},

	irDevices: {
		call: function() {
			const devices = [];
			let ls = popen('ls -1d /sys/class/rc/rc* 2>/dev/null', 'r');
			const raw = trim(ls ? (ls.read('all') || '') : '');
			if (ls)
				ls.close();
			const lines = split(raw, '\n');
			for (let i = 0; i < length(lines); i++) {
				const p = trim(lines[i]);
				if (!length(p))
					continue;
				let uevent = '';
				try {
					uevent = readfile(`${p}/uevent`);
				} catch (e) {
					try {
						uevent = readfile(`${p}/device/uevent`);
					} catch (e2) {}
				}
				push(devices, { id: basename(p), uevent: trim(uevent) });
			}
			return { devices };
		}
	},

	irApply: {
		call: function() {
			if (!access(IR_KEYTABLE))
				return { ok: false, output: 'ir-keytable missing; install v4l-utils' };
			const proc = popen(`${IR_KEYTABLE} -a 2>&1`, 'r');
			if (!proc)
				return { ok: false, output: 'popen failed' };
			const output = trim(proc.read('all') || '');
			const code = proc.close();
			return { ok: code == 0, output, code };
		}
	},

	moduleDiagnostics: {
		call: function() {
			const uname_r = uname_release();
			const mod_r = kernel_release_for_modules();
			const pm = proc_modules_set();
			const procset = pm.set;
			const proc_count = pm.count;

			const lib_path = length(mod_r) ? `/lib/modules/${mod_r}` : '/lib/modules';
			const lib_exists = !!access(lib_path);
			let items = [];
			let required_ok = true;
			let ir_ok = true;

			for (let i = 0; i < length(DIAG_MODULES); i++) {
				const row = DIAG_MODULES[i];
				const st = module_state(row.module, procset);
				const miss = st == 'missing';
				if (!row.optional && miss)
					required_ok = false;
				if ((row.module == 'rc_core' || row.module == 'gpio_ir_recv') && miss)
					ir_ok = false;
				push(items, {
					module: row.module,
					label: row.label,
					optional: row.optional,
					state: st
				});
			}

			const modules_dep = lib_exists && !!access(`${lib_path}/modules.dep`);

			return {
				uname_r,
				modules_release: mod_r,
				lib_modules_path: lib_path,
				lib_modules_exists: lib_exists,
				proc_modules_count: proc_count,
				modules_dep,
				items,
				required_ok,
				ir_stack_ok: ir_ok
			};
		}
	},

	debugReport: {
		call: function() {
			return { report: debug_report() };
		}
	},

	fanGet: {
		call: function() {
			let mode = uci_get_opt('fan_mode', 'auto');
			let pwm_uci = clamp_pwm(uci_get_opt('fan_pwm', '192'));
			let base = find_fan_hwmon();
			const pm = proc_modules_set();
			const diag = fan_diag(base, pm.set);
			if (!base)
				return { present: false, mode, pwm_uci, diagnostics: diag };
			let pwm1 = '', en = '', rpm = '';
			try {
				pwm1 = trim(readfile(`${base}/pwm1`));
			} catch (e) {}
			try {
				en = trim(readfile(`${base}/pwm1_enable`));
			} catch (e) {}
			try {
				rpm = trim(readfile(`${base}/fan1_input`));
			} catch (e) {}
			return {
				present: true,
				path: base,
				pwm1,
				pwm1_enable: en,
				rpm,
				mode,
				pwm_uci,
				diagnostics: diag
			};
		}
	},

	fanSet: {
		args: { mode: 'mode', pwm: 'pwm' },
		call: function(req) {
			let mode = req.args?.mode;
			let pwm_arg = req.args?.pwm;
			if (type(mode) != 'string' || !match(mode, /^(auto|manual|off)$/))
				return { error: 'invalid_mode' };
			let pwmv = clamp_pwm(pwm_arg != null ? pwm_arg : uci_get_opt('fan_pwm', '192'));
			uci_set_opt('fan_mode', mode);
			uci_set_opt('fan_pwm', `${pwmv}`);
			let base = find_fan_hwmon();
			return fan_apply_hw(base, mode, pwmv);
		}
	},

	fanTest: {
		args: { pwm: 'pwm' },
		call: function(req) {
			let pwmv = clamp_pwm(req.args?.pwm != null ? req.args.pwm : '255');
			let base = find_fan_hwmon();
			let res = fan_apply_hw(base, pwmv > 0 ? 'manual' : 'off', pwmv);
			if (res.error)
				return res;
			return { ok: true, pwm: pwmv, path: base || '' };
		}
	}
};

return { 'luci.peripherals': methods };
