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

/*
 * pwm-fan hwmon: name "pwmfan". pwm1_enable uses driver enums (see pwm-fan.c):
 * 0 off, 1 default/thermal-friendly (pwm_disable_reg_enable), 2 full PWM path (manual).
 */
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

	fanGet: {
		call: function() {
			let mode = uci_get_opt('fan_mode', 'auto');
			let pwm_uci = clamp_pwm(uci_get_opt('fan_pwm', '192'));
			let base = find_fan_hwmon();
			if (!base)
				return { present: false, mode, pwm_uci };
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
				pwm_uci
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
	}
};

return { 'luci.peripherals': methods };
