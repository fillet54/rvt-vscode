// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs');
const hasbin = require('hasbin');
const path = require('path');
const { spawnSync, spawn } = require('child_process')
const clonedeep = require('lodash.clonedeep')

const languageclient = require('vscode-languageclient');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

let client;
let _channel;
let _promise = new Promise(function (resolve) { resolve(); });
let _pyPath = null;
let _pyCmd = null;

function isEmpty(value) {
	return typeof value == 'string' && !value.trim()
		|| typeof value == 'undefined'
		|| value === null;
}

function pathExists(value) {
	try {
		if (fs.existsSync(value)) {
			return true;
		}
	} catch (err) {
		// Nothing
	}
	return false;
}

function getPythonCmd() {
	let pyPath = vscode.workspace.getConfiguration().get("RVT.pythonPath");
	if (!pathExists(pyPath)) {
		// Check if python is on PATH just for kicks
		if (hasbin.sync('python')) {
			return {
				command: 'python',
				options: {}
			}
		}
		// python not found
		return null
	}

	// Return cached result if environment hasnt changed
	if (_pyPath == pyPath) {
		return _pyCmd;
	}

	_pyPath = pyPath
	_pyCmd = {
		command: pyPath,
		options: {}
	}

	// Check if path is a virtual environment
	const IS_VIRTUALENV = 1
	const result = spawnSync(pyPath, ["-c", `import sys; if hasattr(sys, 'real_prefix'): return sys.exit(${IS_VIRTUALENV}); sys.exit(0)`])

	if (result.status == IS_VIRTUALENV) {
		const env = process.env
		const sep = process.platform === "win32" ? ';' : ':'
		// Setup what activate does
		env.PATH = `${pyPath}${sep}${env.PATH}`
		env.VIRTUAL_ENV = path.dirname(path.dirname(pyPath))
		delete env.PYTHONHOME
		// Set options in command
		_pyCmd.options = { env }
	}

	// return cloned to prevent modifcation
	return clonedeep(_pyCmd);
}

function getOutputChannel() {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('RVT');
	}
	return _channel;
}

function runblocks() {
	let editor = vscode.window.activeTextEditor;

	if (editor) {
		let document = editor.document;
		let selection = editor.selection;
		let text = document.getText(selection);

		//let automationEntryPoint = path.join(vscode.workspace.getConfiguration().get("RVT.automationEntryPoint"))
		//let automationArgs = path.join(vscode.workspace.getConfiguration().get("RVT.automationArguments"))
		//let automationPath = path.join(vscode.workspace.getConfiguration().get("RVT.automationPath"), automationEntryPoint)
		let automationPath = vscode.workspace.getConfiguration().get("RVT.automationPath");
		let pythonCmd = getPythonCmd();

		if (!pythonCmd || isEmpty(automationPath)) {
			getOutputChannel().appendLine("Error python not found");
			return;
		}

		// Set our options
		pythonCmd.args = ['queuerunner.py', 'snippet', text]
		pythonCmd.options.cwd = automationPath

		// really should be process
		_promise = spawn(pythonCmd.command, pythonCmd.args, pythonCmd.options)
		_promise.stdout.on('data', (data) => {
			getOutputChannel().appendLine(data);
		});
		_promise.stderr.on('data', (data) => {
			getOutputChannel().appendLine(data);
		});
		_promise.on('close', (code) => {
			getOutputChannel().appendLine("Completed");
			_promise = null;
		})

		/*
		_promise = _promise.then(function () {
			let channel = getOutputChannel();
			channel.appendLine("Going to " + pythonCmd.command + " run in 10 seconds")
			return new Promise(function (resolve) {
				setTimeout(function () {
					channel.appendLine("About to run:")
					channel.appendLine(JSON.stringify(pythonCmd));
					resolve();
				}, 1000);
			})
		});
		*/
	}
}

function startLanguageServer() {
	let pyCmd = getPythonCmd();
	let automationPath = vscode.workspace.getConfiguration().get("RVT.automationPath");
	let languageServerPackage = vscode.workspace.getConfiguration().get("RVT.languageServerPackage");

	if (!pyCmd) {
		vscode.window.showErrorMessage("RVT: Could not start language server. Python not configured.");
		return;
	}

	if (!pathExists(automationPath)) {
		vscode.window.showErrorMessage("RVT: Could not start Language Server. Automation Path not found.");
		return;
	}

	getOutputChannel().appendLine("Starting RVT Language Server");

	let serverOptions = pyCmd
	serverOptions.args = ['-m', languageServerPackage]
	serverOptions.options.cwd = automationPath

	let clientOptions = {
		documentSelector: [{ scheme: 'file', language: 'rvt' }]
	};

	client = new languageclient.LanguageClient(
		'rvtLanguageServer',
		'RVT Language Server',
		serverOptions,
		clientOptions);

	client.start()
}

function stopLanguageServer() {
	if (!client) {
		return new Promise(function (resolve) { resolve(); });
	}
	// Language server already started	
	getOutputChannel().appendLine("Stop RVT Language Server");
	let _client = client;
	client = undefined;
	return _client.stop();
}

function restartLanguageServer() {
	return stopLanguageServer().then(startLanguageServer);
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "rvt" is now active!');

	// Register Commands
	let cmdRunBlock = vscode.commands.registerCommand('extension.executeBlock', runblocks);
	let cmdRestartLang = vscode.commands.registerCommand('extension.restartLanguageServer', restartLanguageServer);

	context.subscriptions.push(cmdRunBlock);
	context.subscriptions.push(cmdRestartLang);

	startLanguageServer();
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {
	stopLanguageServer();
}

module.exports = {
	activate,
	deactivate
}
