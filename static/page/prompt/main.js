
"use strict";

import {DOM, Animate} from '../../base/dom.js'
import {command} from '../../base/command.js'
import {channel} from '../../base/channel.js'
import {Tool} from '../../base/tool.js'

class Prompt {
  constructor (){
    this.name = 'prompt'
    this.inited = false
    this.prompt = new Terminal ()
    this.locked = false // Soft mirror from channel status

    let $ = this._dom = {}
    $.section = new DOM(DOM.get('section#prompt'))
    $.promptXterm = new DOM('div', {className:"xterm"})
    $.stopProgramButton = new DOM('button', {
        innerText:Msg['StopExecution'],
        className:'master'
      })
      .onclick(command, () => {
        command.dispatch(channel, 'push', [
            '\x03',
            channel.targetDevice, [], command.tabUID
          ])
        })
    $.quickActions = new DOM('div', {className:"quick-actions"})
      .append([
        new DOM('button', {innerText:Msg['ClearConsole']})
          .onclick(this, ()=>{this.prompt.clear()}),
        new DOM('button', {innerText:Msg['ResetDevice'], className:'master'})
          .onclick(command, () => {
            command.dispatch(channel, 'push', [
                '\x04',
                channel.targetDevice, [], command.tabUID
              ])
            }),
        $.stopProgramButton,
        new DOM('button', {innerText:Msg['StopTimers'], className:'master'})
          .onclick(command, () => {
            command.dispatch(channel, 'push', [
                'from machine import Timer; [Timer(i).deinit() for i in range(0,16)]\r',
                channel.targetDevice, [], command.tabUID
              ])
            }),
        new DOM('button', {innerText:Msg['DeviceInfo'], className:'master'})
          .onclick(command, () => {
            command.dispatch(channel, 'push', [
                'import os; os.uname()\r',
                channel.targetDevice, [], command.tabUID
              ])
            }),
          ])

    $.container = new DOM('div', {className:"container"})
      .append([
        new DOM('div', {className:"wrapper"}).append($.promptXterm),
        $.quickActions
      ])

    this.prompt.open($.promptXterm._dom)
    this.prompt.setOption('fontSize',14)
    this.prompt.onData((data) => {
      // If tab is master, write directly to reduce delay
      if (channel.current != undefined)
        channel.rawPush(data, channel.targetDevice)
      else
        command.dispatch(channel, 'rawPush', [data, channel.targetDevice])
    });

    DOM.get('section#prompt').append($.container._dom)

    $.statusTasks = new DOM('div')
    $.statusTasksButton = new DOM('button', {
        className:'status-icon',
        id:'tasks',
        title:Msg['TasksRunning']
      })
      .append($.statusTasks)
      .onclick(this, () => {
        this.nav.click()
        this._dom.stopProgramButton.focus()
      })

    new DOM(DOM.get('div#status-bar #globals')).append([
      $.statusTasksButton
    ])

    this.progress = new PromptProgress()

    // Cross tabs event handler on muxing prompt
    command.add(this, {
      write: this._write
    }, true)
    command.add(this, {
      ping: this._ping
    },)
    // Object to delay dispatch
    this.tabs = {
      data:'',
      targetDevice:'',
      watcher:setInterval (() => {
        if (this.tabs.data != '')
          command.dispatch(this, 'write', [this.tabs.data, channel.targetDevice]),
          this.tabs.data = ''
      }, 25)
    }
    // Object to send status to connected tabs when channel is master
    this.pingInterval = setInterval (() => {
      if (channel.current === undefined)
        return
      command.dispatch(this, 'ping', [{
        dirty: channel.dirty,
        lock: channel.lock,
        callback: channel.callbacks.length
      },  channel.targetDevice])
    }, 750)
  }
  /** On display, initiates the page. */
  init (){
    if (this.inited)
      return
    this.inited = true
  }
  /** On hidden, deinitiates the page. */
  deinit (){
    if (!this.inited)
      return
    this.inited = false
  }

  /**
   * Receive status from current device's master tab
   */
  _ping (obj, target){
    if(target !== channel.targetDevice)
      return

    if (obj.dirty || (!obj.lock && obj.callback > 0)) {
      this._dom.statusTasksButton.classList.add('dirty')
      this._dom.statusTasks.innerText = Msg['StatusOngoingInput']
      this.locked = true
    } else if(obj.lock && obj.callback > 0) {
      this._dom.statusTasksButton.classList.add('working')
      if (obj.callback == 1)
        this._dom.statusTasks.innerText = Msg['StatusWorkingOne']
      else
        this._dom.statusTasks.innerText = Tool.format([
          Msg['StatusWorking'], obj.callback
        ])
      this.locked = true
    } else {
      this.locked = false
      this._dom.statusTasksButton.classList.remove('dirty')
      this._dom.statusTasksButton.classList.remove('working')
      this._dom.statusTasks.innerText = Msg['StatusReady']
    }
  }
  /** Enable the prompt. **/
  on (){
    this._dom.statusTasksButton.classList.add('on')

    if(!this.inited)
      return

    this.prompt.setOption('disableStdin', false);
    this.prompt.focus();
  }
  /** Disable the prompt. */
  off (){
    this._dom.statusTasksButton.classList.remove('on')

    if(!this.inited)
      return

    this.prompt.setOption('disableStdin', true);
    this.prompt.blur();
  }
  /** Write data in the prompt. */
  write (data){
    this.prompt.write(data);

    // Write to delayed dispatch
    if (this.tabs.target != channel.targetDevice)
      this.tabs.data = data,
      this.tabs.target = channel.targetDevice
    else
      this.tabs.data += data

  }
  _write (data, target){
    if(channel.targetDevice != target)
      return
    this.prompt.write(data)
  }
  /**
   * Resize the ``xterm.js`` prompt, triggered by ``window.onresize`` event on
   * on base/navigation.js.
   */
  resize (){
    if(!this.inited)
      return

    let cols = (this._dom.section.width - 5*16)/7,
        rows = (this._dom.section.height/17 - 4*16/14)

    this.prompt.resize(parseInt(cols), parseInt(rows))
  }
  /*
   * Show progress bar.
   * @param {number} a - Loaded.
   * @param {number} b - Total.
   */
   setLoading (a, b){
      this.progress.load(a, b)
   }
   /** Hide progress bar */
   endLoading (){
      this.progress.end()
   }
}

/** Creates a progress bar. */
class PromptProgress {
  // DOM node element for the progress bar.*/
  constructor (){
    this.div = new DOM('div')
    this.dom = new DOM('div', {
      id:'prompt',
      className:'progress-bar'
    }).append(this.div)

    document.body.append(this.dom._dom)
  }
	/**
   * Sets the progress bar width by the loaded and total to load, e.g. loaded=256, total=1024 equals 75%.
   * @param {number} loaded - How much has been loaded.
   * @param {number} total - Total to load.
   */
	load (loaded, total) {
	  if (!this.dom.classList.contains('on'))
	    this.dom.classList.add('on')

		let percent = (loaded * 100 / total)
		this.div.style.width = percent + '%'
	}
	end () {
	  this.dom.classList.remove('on')
    this.div.style.width = '0%'
	}
}

export let prompt = new Prompt()