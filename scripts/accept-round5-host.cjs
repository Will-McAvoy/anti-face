// Real-host checklist. Refuses unless a window is named and temporary restyle is explicitly allowed.
const target = process.argv.find(item => item.startsWith('--target='))?.slice('--target='.length) || '';
const allow = process.argv.includes('--allow-restyle');
const checklist = [
  '记录指定窗口当前外观和已应用会话，不关闭正在运行的任务。',
  '不输入、不发送聊天，不修改官方安装包。',
  '首页和聊天页各识别一次，未知页面必须保持不确定。',
  '浅色和深色下分别看正文、代码、输入框，不把平均亮度当成可读。',
  '宽窗口和窄窗口各看一次构图，文字区被裁掉要有提示。',
  '制造一次样式被盖住，确认失败提示、恢复和不再报保存成功。',
  '截图必须来自指定窗口；换窗口后旧图不能当成新窗口。',
  '手动固定后，定时和项目切换不能盖住当前外观。',
  '两个窗口各用一套主题，确认颜色和会话没有串。',
  '结束时恢复原外观，并核对恢复状态。单显示器不能记成多显示器通过。'
];
console.log('第五轮真实宿主验收清单');
checklist.forEach((item, index) => console.log(`${index + 1}. ${item}`));
if (!target || !allow) {
  console.log('状态 2：已实现，真实环境待验证。没有执行换肤或截图。');
  console.log('只有在指定测试窗口并允许临时换肤时才运行：node scripts/accept-round5-host.cjs --target=窗口标题 --allow-restyle');
  process.exitCode = 2;
} else {
  console.log(`已收到窗口「${target}」和临时换肤许可，但本脚本不会自动注入。请按上面的清单在该窗口手工复核，截图不要提交真实聊天。`);
  process.exitCode = 2;
}
