
const puppeteer = require('puppeteer-core');
const chromium  = require('chrome-aws-lambda');
const request   = require('request');
const {SITE_ID, SITE_PW, GAS_URL, SLACK_URL, SHEET_URL, BASE_URL} = require('./config.json');

exports.handler = async (event, context) => {
  
  let browser       = null;
  let page          = null;
  const year        = event.year;
  const month       = event.month;
  const day         = event.day;
  const date        = year + '-' + month + '-' + day;
  const hour        = event.hour;
  const minute      = event.minute;
  const time        = hour + ':' + minute;
  const command     = event.command == '開始' ? 'clock_in_at': 'clock_out_at';
  const employee_id = event.employee_id;
  const next_month  = month == '12' ? (Number(year) + 1)  + '/1' : year + '/' + (Number(month) + 1);

  try {
    
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    
    page = await browser.newPage();
    
    await page.goto(BASE_URL + next_month +'/employees/' + employee_id);
    
    await page.focus('input[name=email]');
    await page.type('input[name=email]',SITE_ID);
    await page.focus('input[name=password]');
    await page.type('input[name=password]',SITE_PW);

    const input_element = await page.$('input[type=submit]');
    await input_element.click();
    await page.waitFor(5000);

    let calendar = await page.$('[data-date="' + date + '"]');
    await calendar.click();
    await page.waitFor(2000);

    await page.focus('input[name=' + command + ']');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    await page.type('input[name=' + command + ']', time);
    
    const remove_break_buttons = await page.$$('.break-records-editor__remove-break-button');
    for (let i = 0; i < remove_break_buttons.length; i++) {
      await remove_break_buttons[0].click();
    }

    if (command == 'clock_out_at') {
      //勤務時間を取得する
      const work_time_tag = await page.$('span.time-range-input__diff');
      let work_time       = await (await work_time_tag.getProperty('textContent')).jsonValue();
      work_time = work_time.match(/^\d+/g);
      
      //勤務時間が6時間以上の場合は休憩時間を入力する
      if (work_time >= 6) {
        const add_break_button = await page.$('div.break-records-editor > .sw-button');
        await add_break_button.click();
        
        await page.focus('input[name=break_record_0_clock_in_at]');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.type('input[name=break_record_0_clock_in_at]', (Number(hour) - 4) + ':' + minute);
        
        await page.focus('input[name=break_record_0_clock_out_at]');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.type('input[name=break_record_0_clock_out_at]', (Number(hour) - 3) + ':' + minute);
      }
    }
    
    const save_button = await page.$('.work-record-edit-modal__footer-control.sw-button-primary');
    //const save_button = await page.$('.work-record-edit-modal__footer-control.sw-button');//デバッグ用の閉じるボタン
    console.log('セーブ前');
    await save_button.click();
    
    //const page = await browser.newPage();
    await page.goto('http://www.meigensyu.com/quotations/view/random');
    await page.waitFor('.meigenbox')
    const meigen = await page.$eval('div.meigenbox .text', item => {
      return item.textContent;
    });
    
    //slackに通知
    const slack_options = {
      url: SLACK_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      json: {
        username: 'freee打刻',
        icon_emoji: ':alarm_clock:',
        text: meigen,
      }
    }

    request(slack_options, function (error, response, body) {});
    
    
  } catch (e) {
    
    //スプレッドシートに記録
    var options = {
      url: GAS_URL,
      method: 'POST',
      headers: 'Content-Type:application/json',
      json: {
        message: '',
        event: ''
      }
    }
    
    //eventを文字列にしてtextにつなげる
    var event_json = JSON.stringify(event);

    options['json']['message'] = String(e).replace(/:|\\\'/g, '、') + ' email→' + event.email + ' timestamp→' + event.timestamp;
    options['json']['event'] = event_json;
    
    request(options, function (error, response, body) {});

    //slackに通知
    var slack_options = {
      url: SLACK_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      json: {
        username: 'freee打刻',
        icon_emoji: ':alarm_clock:'
      }
    }
    slack_options['json']['text'] = '打刻が失敗しました！[email→' + event.email + '] エラーログを確認してください。' + SHEET_URL;
    request(slack_options, function (error, response, body) {});
    await page.waitFor(5000);

    return context.fail(e);
    
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }

  return event.user_name;
};
