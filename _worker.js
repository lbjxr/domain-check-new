// 定义外部变量
let sitename = "域名监控"; //变量名SITENAME，自定义站点名称，默认为"域名监控"
let domains = ""; //KV空间创建SECRET_KV后，新增一组kv对，填入域名信息json格式，必须设置的变量
let tgid = ""; //变量名TGID，填入TG机器人ID，不需要提醒则不填
let tgtoken = ""; //变量名TGTOKEN，填入TG的TOKEN，不需要提醒则不填
let days = 7; //变量名DAYS，提前几天发送TG提醒，默认为7天，必须为大于0的整数

// 获取Bing每日图片的函数
async function handleBingImagesRequest() {
    const cache = caches.default;
    const cacheKey = new Request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('Returning cached response');
      return cachedResponse;
    }
    try {
      const res = await fetch(cacheKey);
      if (!res.ok) {
        console.error(`Bing API 请求失败，状态码：${res.status}`);
        return new Response('请求 Bing API 失败', { status: res.status });
      }
      const bingData = await res.json();
      const images = bingData.images.map(image => ({ url: `https://cn.bing.com${image.url}` }));
      const returnData = { status: true, message: "操作成功", data: images };
      const response = new Response(JSON.stringify(returnData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=21600',
          'Access-Control-Allow-Origin': '*'
        }
      });
      await cache.put(cacheKey, response.clone());
      console.log('响应数据已缓存');
      return response;
    } catch (error) {
      console.error('请求 Bing API 过程中发生错误:', error);
      return new Response('请求 Bing API 失败', { status: 500 });
    }
  }  

//发送消息方法，默认只支持TG
async function sendtgMessage(message, tgid, tgtoken) {
  if (!tgid || !tgtoken) return;
  const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`;
  const params = {
    chat_id: tgid,
    text: message,
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (error) {
    console.error('Telegram 消息推送失败:', error);
  }
}

//定时检查域名到期时间并发送消息
async function handleScheduled(event,env) {
  
  tgid = env.TGID || tgid;
  tgtoken = env.TGTOKEN || tgtoken;
  days = Number(env.DAYS || days);

  try {
    const domainsKV = await env.SECRET_KV.get('domains');
    domains = domainsKV ? JSON.parse(domainsKV) : [];
    if (!Array.isArray(domains)) throw new Error('JSON 数据格式不正确');
  } catch (error) {
    return  await sendtgMessage("从Cloudflare KV中获取的 JSON 数据格式不正确", tgid, tgtoken); 
  }

  try {
       
    const today = new Date().toISOString().split('T')[0]; // 当前日期字符串

    for (const domain of domains) {
      const expirationDate = new Date(domain.expirationDate);
      // @ts-ignore
      const daysRemaining = Math.ceil((expirationDate - new Date()) / (1000 * 60 * 60 * 24));

      if (daysRemaining > 0 && daysRemaining <= days) {
        const escapeMD = (str) => str.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
        const message = `
        【域名过期提醒】
        
        ⚠️ 域名:  ${escapeMD(domain.domain)}
        ⏰ 剩余时间:  ${daysRemaining}天（到期时间：${domain.expirationDate}）
        🏷️ 注册服务商:  ${escapeMD(domain.system)}
        🔗 注册地址:  ${domain.systemURL}
        📝 备注:  ${domain.remark || '无'}
          `;
          

        const lastSentDate = await env.DOMAINS_TG_KV.get(domain.domain); // 以域名为键获取上次发送时间
        
        if (lastSentDate !== today) { // 检查是否已经在今天发送过
          await sendtgMessage(message, tgid, tgtoken); // 发送通知
          await env.DOMAINS_TG_KV.put(domain.domain, today); // 更新发送日期
        }
      }
    }

    console.log("域名检查完成");
  } catch (error) {
    console.error("Fetch error:", error);
  }
}

// 保存域名信息
async function saveDomainToKV(env, domainInfo) {
  const domainsKV = env.SECRET_KV;
  const domains = await domainsKV.get('domains') || '[]';
  const domainsArray = JSON.parse(domains);

  domainsArray.push(domainInfo);
  await domainsKV.put('domains', JSON.stringify(domainsArray));
}

// 删除域名信息
async function deleteDomainFromKV(env, domainName) {
  const domainsKV = env.SECRET_KV;
  const domains = await domainsKV.get('domains') || '[]';
  const domainsArray = JSON.parse(domains);

  const updatedDomainsArray = domainsArray.filter(domain => domain.domain !== domainName);
  await domainsKV.put('domains', JSON.stringify(updatedDomainsArray));
}

// 编辑域名信息
async function editDomainInKV(env, updatedDomainInfo) {
  const domainsKV = env.SECRET_KV;
  const domains = await domainsKV.get('domains') || '[]';
  const domainsArray = JSON.parse(domains);
  
  const lowerCaseDomain = updatedDomainInfo.domain.toLowerCase();
  const index = domainsArray.findIndex(domain => domain.domain.toLowerCase() === lowerCaseDomain);
  if (index !== -1) {
    // 如果域名发生变化，需要先删除旧域名再添加新域名
    if (updatedDomainInfo.originalDomain !== updatedDomainInfo.domain) {
      domainsArray.splice(index, 1);
      const newDomainInfo = {
        domain: updatedDomainInfo.domain,
        registrationDate: updatedDomainInfo.registrationDate,
        expirationDate: updatedDomainInfo.expirationDate,
        system: updatedDomainInfo.system,
        systemURL: updatedDomainInfo.systemURL,
        remark: updatedDomainInfo.remark,
        sortOrder: updatedDomainInfo.sortOrder
      };
      domainsArray.push(newDomainInfo);
    } else {
      domainsArray[index] = {
        domain: updatedDomainInfo.domain,
        registrationDate: updatedDomainInfo.registrationDate,
        expirationDate: updatedDomainInfo.expirationDate,
        system: updatedDomainInfo.system,
        systemURL: updatedDomainInfo.systemURL,
        remark: updatedDomainInfo.remark,
        sortOrder: updatedDomainInfo.sortOrder
      };
    }
    await domainsKV.put('domains', JSON.stringify(domainsArray));
  } else {
    throw new Error('Domain not found');
  }
}

// 生成密码验证页面
async function generatePasswordPage() {
  const siteIcon = 'https://pan.811520.xyz/icon/domain.png';
  const bingResponse = await handleBingImagesRequest();
  const bingData = await bingResponse.json();
  const bgimgURL = bingData.data[0].url;
  
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>域名监控系统</title>
      <link rel="icon" href="${siteIcon}" type="image/png">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background-image: url('${bgimgURL}');
          background-repeat: no-repeat;
          background-size: 100% 100%;
          color: #333;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .password-container {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          flex-direction: column;
        }
        .password-input {
          background-color: rgba(255, 255, 255, 0.7);
          border: none;
          border-radius: 10px;
          padding: 10px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          margin-bottom: 10px;
        }
        .login-title {
          color: white;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
          margin-bottom: 20px;
        }
        .login-button {
          background-color: #3498db;
          color: white;
          border: none;
          border-radius: 5px;
          padding: 10px 20px;
          cursor: pointer;
          margin-top: 10px;
          font-weight: bold;
        }
        .login-button:hover {
          background-color: #2980b9;
        }
      </style>
    </head>
    <body>
      <div class="password-container">
        <h2 class="login-title">域名监控系统</h2>
        <input type="password" id="password-input" class="password-input" placeholder="请输入密码">
        <button id="login-button" class="login-button">登录</button>
      </div>
      <script>
        document.getElementById('login-button').addEventListener('click', verifyPassword);
        document.getElementById('password-input').addEventListener('keypress', function(event) {
          if (event.key === 'Enter') {
            verifyPassword();
          }
        });
        
        async function verifyPassword() {
          const password = document.getElementById('password-input').value;
          
          try {
            const response = await fetch('/verify-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password })
            });
            
            const result = await response.json();
            
            if (result.success) {
              // 密码正确，使用服务器返回的令牌重定向到域名列表页面
              window.location.href = '/domains?token=' + encodeURIComponent(result.token);
            } else {
              alert('密码错误');
            }
          } catch (error) {
            alert('验证失败，请重试');
            console.error('验证失败:', error);
          }
        }
      </script>
    </body>
    </html>
  `;
}

// 生成域名列表页面
async function generateDomainListPage(domains, SITENAME) {
  const siteIcon = 'https://pan.811520.xyz/icon/domain.png';
  const bingResponse = await handleBingImagesRequest();
  const bingData = await bingResponse.json();
  const bgimgURL = bingData.data[0].url;
  const rows = await Promise.all(domains.map(async info => {
    const registrationDate = new Date(info.registrationDate);
    const expirationDate = new Date(info.expirationDate);
    const today = new Date();
    const totalDays = (expirationDate - registrationDate) / (1000 * 60 * 60 * 24);
    const daysElapsed = (today - registrationDate) / (1000 * 60 * 60 * 24);
    const progressPercentage = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
    const daysRemaining = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
    const isExpired = today > expirationDate;
    const statusColor = isExpired ? '#e74c3c' : '#2ecc71';
    const statusText = isExpired ? '已过期' : '正常';

    return `
    <tr data-domain="${info.domain}" draggable="true">
        <td><span class="status-dot" style="background-color: ${statusColor};" title="${statusText}"></span></td>
        <td>${info.sortOrder}</td>
        <td>${info.domain}</td>
        <td><a href="${info.systemURL}" target="_blank">${info.system}</a></td>
        <td>${info.registrationDate}</td>
        <td>${info.expirationDate}</td>
        <td>${isExpired ? '已过期' : daysRemaining + ' 天'}</td>
        <td>
          <div class="progress-bar">
            <div class="progress" style="width: ${progressPercentage}%;"></div>
          </div>
        </td>
        <td>${info.remark || '无'}</td>
        <td>
          <button onclick="editDomain('${info.domain}', '${info.registrationDate}', '${info.expirationDate}', '${info.system}', '${info.systemURL}', '${info.remark}', ${info.sortOrder})" class="edit-btn">编辑</button>
          <button onclick="deleteDomain('${info.domain}')" class="delete-btn">删除</button>
        </td>
      </tr>
    `;
  }));

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${SITENAME}</title>
      <link rel="icon" href="${siteIcon}" type="image/png">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background-image: url('${bgimgURL}');
          background-repeat: no-repeat;
          background-size: 100% 100%;
          color: #333;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .container {
          flex: 1;
          width: 95%;
          max-width: 1200px;
          margin: 20px auto;
          background-color: rgba(255, 255, 255, 0.7);
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          border-radius: 5px;
          overflow: hidden;
        }
        h1 {
          background-color: #3498db;
          color: #fff;
          padding: 20px;
          margin: 0;
        }
        .table-container {
          width: 100%;
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          white-space: nowrap;
          table-layout: auto;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #ddd;
          white-space: nowrap;
        }
        th {
          background-color: rgba(242, 242, 242, 0.7);
          font-weight: bold;
        }
        .status-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: #2ecc71;
        }
        .progress-bar {
          width: 100%;
          min-width: 100px;
          background-color: #e0e0e0;
          border-radius: 4px;
          overflow: hidden;
        }
        .progress {
          height: 20px;
          background-color: #3498db;
        }
        .footer {
          text-align: center;
          padding: 0;
          background-color: #3498db;
          font-size: 0.9rem;
          color: #fff;
          margin-top: auto;
        }
        .footer a {
          color: white;
          text-decoration: none;
          margin-left: 10px;
          transition: color 0.3s ease;
        }
        .footer a:hover {
          color: #f1c40f;
        }
        #add-domain-form {
          padding: 15px;
          background-color: rgba(255, 255, 255, 0.5);
          margin-bottom: 15px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        #add-domain-form input {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          flex: 1;
        }
        #add-domain-form button {
          padding: 8px 15px;
          background-color: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        #add-domain-form button:hover {
          background-color: #2980b9;
        }
         .edit-btn, .delete-btn {
          padding: 5px 10px;
          margin: 0 5px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }
        .edit-btn {
          background-color: #f39c12;
          color: white;
        }
        .edit-btn:hover {
          background-color: #e67e22;
        }
        .delete-btn {
          background-color: #e74c3c;
          color: white;
        }
        .delete-btn:hover {
          background-color: #c0392b;
        }
        
        /* 模态框样式 */
        .modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
        }
        .modal-content {
          background-color: white;
          margin: 10% auto;
          padding: 20px;
          border-radius: 5px;
          width: 80%;
          max-width: 500px;
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #eee;
          padding-bottom: 10px;
          margin-bottom: 15px;
        }
        .modal-header h3 {
          margin: 0;
        }
        .close-modal {
          font-size: 24px;
          font-weight: bold;
          cursor: pointer;
        }
        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .modal-form input {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .modal-form button {
          padding: 10px;
          background-color: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 10px;
        }
        .modal-form button:hover {
          background-color: #2980b9;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${SITENAME}</h1>
        <form id="add-domain-form">
          <input type="text" id="domain" placeholder="域名" required>
          <input type="date" id="registrationDate" placeholder="注册日期" required>
          <input type="date" id="expirationDate" placeholder="过期日期" required>
          <input type="text" id="system" placeholder="注册商" required>
          <input type="url" id="systemURL" placeholder="注册商 URL" required>
          <input type="number" id="sortOrder" placeholder="排序值" value="0">
          <input type="text" id="remark" placeholder="备注">
          <button type="submit">添加域名</button>
        </form>
        <div class="table-container">
          <table id="domain-table">
          <table>
            <thead>
              <tr>
                <th onclick="sortTable(0)">状态</th>
                <th onclick="sortTable(1)">序号</th>
                <th onclick="sortTable(2)">域名</th>
                <th onclick="sortTable(3)">域名注册商</th>
                <th onclick="sortTable(4)">注册时间</th>
                <th onclick="sortTable(5)">过期时间</th>
                <th onclick="sortTable(6)">剩余天数</th>
                <th onclick="sortTable(7)">使用进度</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${rows.join('')}
            </tbody>
          </table>
        </div>
      </div>

      
      <!-- 编辑域名的模态框 -->
      <div id="edit-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>编辑域名信息</h3>
            <span class="close-modal">&times;</span>
          </div>
          <form id="edit-domain-form" class="modal-form">
            <input type="hidden" id="edit-domain-original">
            <input type="text" id="edit-domain" placeholder="域名" required>
            <input type="date" id="edit-registrationDate" placeholder="注册日期" required>
            <input type="date" id="edit-expirationDate" placeholder="过期日期" required>
            <input type="text" id="edit-system" placeholder="注册商" required>
            <input type="url" id="edit-systemURL" placeholder="注册商 URL" required>
            <input type="number" id="edit-sortOrder" placeholder="排序值">
            <input type="text" id="edit-remark" placeholder="备注">
            <button type="submit">保存修改</button>
          </form>
        </div>
      </div>
      
      <div class="footer">
        <p>
          Copyright © 2025 Yutian81&nbsp;&nbsp;&nbsp;|
          <a href="https://github.com/yutian81/domain-check" target="_blank">GitHub Repository</a>&nbsp;&nbsp;&nbsp;|
          <a href="https://blog.811520.xyz/" target="_blank">青云志博客</a>
        </p>
      </div>
      <script>
        // 处理表单提交
        const form = document.getElementById('add-domain-form');
        form.addEventListener('submit', async function(event) {
          event.preventDefault();
          const domainInfo = {
            domain: document.getElementById('domain').value,
            registrationDate: document.getElementById('registrationDate').value,
            expirationDate: document.getElementById('expirationDate').value,
            system: document.getElementById('system').value,
            systemURL: document.getElementById('systemURL').value,
            sortOrder: parseInt(document.getElementById('sortOrder').value)
          };
          await fetch('/add-domain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(domainInfo)
          });
          alert('域名信息已保存');
          // 刷新页面以显示新添加的域名
          window.location.reload();
        });

        // 删除域名
        async function deleteDomain(domain) {
          if (confirm('确认删除该域名信息?')) {
            await fetch('/delete-domain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain })
            });
            alert('域名信息已删除');
            // 刷新页面以更新域名列表
            window.location.reload();
          }
        }

         
        // 编辑域名相关功能
        const editModal = document.getElementById('edit-modal');
        const closeModalBtn = document.querySelector('.close-modal');
        
        // 关闭模态框
        closeModalBtn.addEventListener('click', function() {
          editModal.style.display = 'none';
        });
        
        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
          if (event.target === editModal) {
            editModal.style.display = 'none';
          }
        });
        
        // 打开编辑模态框并填充数据
        function editDomain(domain, registrationDate, expirationDate, system, systemURL, remark, sortOrder) {
          document.getElementById('edit-domain-original').value = domain;
          document.getElementById('edit-domain').value = domain;
          document.getElementById('edit-registrationDate').value = registrationDate;
          document.getElementById('edit-expirationDate').value = expirationDate;
          document.getElementById('edit-system').value = system;
          document.getElementById('edit-systemURL').value = systemURL;
          document.getElementById('edit-remark').value = remark;
          document.getElementById('edit-sortOrder').value = sortOrder;
          
          editModal.style.display = 'block';
        }
        
        // 处理编辑表单提交
        const editForm = document.getElementById('edit-domain-form');
        editForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          
          const originalDomain = document.getElementById('edit-domain-original').value;
          const domainInfo = {
            domain: document.getElementById('edit-domain').value,
            registrationDate: document.getElementById('edit-registrationDate').value,
            expirationDate: document.getElementById('edit-expirationDate').value,
            system: document.getElementById('edit-system').value,
            systemURL: document.getElementById('edit-systemURL').value,
            remark: document.getElementById('edit-remark').value,
            originalDomain: originalDomain,
            sortOrder: parseInt(document.getElementById('edit-sortOrder').value),
            originalDomain: originalDomain // 添加原始域名以便后端识别
          };
          
          try {
            const response = await fetch('/edit-domain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(domainInfo)
            });
            
            if (response.ok) {
              alert('域名信息已更新');
              // 关闭模态框并刷新页面
              editModal.style.display = 'none';
              window.location.reload();
            } else {
              const errorData = await response.json();
              alert('更新失败: ' + (errorData.message || '未知错误'));
            }
          } catch (error) {
            alert('更新请求失败: ' + error.message);
          }
        });
        
          // 表格排序函数
        function sortTable(n) {
          var table, rows, switching, i, x, y, shouldSwitch, dir, switchcount = 0;
          table = document.getElementById("domain-table");
          switching = true;
          // 设置排序方向为升序
          dir = "asc"; 
          /* 循环直到没有进行交换为止 */
          while (switching) {
            // 开始时假设没有交换
            switching = false;
            rows = table.rows;
            /* 循环遍历除表头外的每一行 */
            for (i = 1; i < (rows.length - 1); i++) {
              // 开始时假设不交换
              shouldSwitch = false;
              /* 获取当前行和下一行要比较的单元格 */
              x = rows[i].getElementsByTagName("TD")[n];
              y = rows[i + 1].getElementsByTagName("TD")[n];
              /* 根据排序方向决定比较逻辑 */
              if (dir == "asc") {
                if (x.innerHTML.toLowerCase() > y.innerHTML.toLowerCase()) {
                  // 如果当前单元格的值大于下一个单元格的值，则需要交换
                  shouldSwitch = true;
                  break;
                }
              } else if (dir == "desc") {
                if (x.innerHTML.toLowerCase() < y.innerHTML.toLowerCase()) {
                  // 如果当前单元格的值小于下一个单元格的值，则需要交换
                  shouldSwitch = true;
                  break;
                }
              }
            }
            if (shouldSwitch) {
              /* 如果需要交换，则交换两行并标记为已交换 */
              rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
              switching = true;
              // 增加交换计数
              switchcount ++; 
            } else {
              /* 如果没有交换且排序方向为升序，则切换到降序并再次尝试排序 */
              if (switchcount == 0 && dir == "asc") {
                dir = "desc";
                switching = true;
              }
            }
          }
        }
      </script>
    </body>
    </html>
  `;
}

// 修改 fetch 函数来使用新的页面生成函数
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
     
   // 检查 URL 中是否包含 password 参数
        const passwordFromURL = url.searchParams.get('password');
        if (passwordFromURL) {
          try {
            const storedPassword = await env.SECRET_KV.get('password');
    
            if (passwordFromURL === storedPassword) {
              // 生成一个简单的会话令牌（在生产环境中应使用更安全的方法）
              const token = btoa(Date.now() + ':' + Math.random());
    
              // 存储令牌（有效期10分钟）
              await env.SECRET_KV.put('auth_token:' + token, 'valid', { expirationTtl: 600 });
    
              // 重定向到域名列表页面
              return new Response(null, {
                status: 302,
                headers: {
                  Location: `/domains?token=${encodeURIComponent(token)}`
                }
              });
            } else {
              return new Response("密码错误", { status: 401 });
            }
          } catch (error) {
            return new Response("验证失败", { status: 500 });
          }
        }  
    // 处理密码验证请求
    if (request.method === 'POST' && url.pathname === '/verify-password') {
      try {
        const { password } = await request.json();
        const storedPassword = await env.SECRET_KV.get('password');
        
        if (password === storedPassword) {
          // 生成一个简单的会话令牌（在生产环境中应使用更安全的方法）
          const token = btoa(Date.now() + ':' + Math.random());
          
          // 存储令牌（有效期10分钟）
          await env.SECRET_KV.put('auth_token:' + token, 'valid', { expirationTtl: 600 });
          
          return new Response(JSON.stringify({ 
            success: true, 
            token: token 
          }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            message: '密码错误' 
          }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: '验证失败' 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 处理其他 POST 请求
    if (request.method === 'POST') {
      const requestBody = await request.json();
      if (url.pathname.endsWith('/add-domain')) {
        await saveDomainToKV(env, requestBody);
        return new Response('域名信息已保存', { status: 200 });
      } else if (url.pathname.endsWith('/delete-domain')) {
        await deleteDomainFromKV(env, requestBody.domain);
        return new Response('域名信息已删除', { status: 200 });
      } else if (url.pathname.endsWith('/edit-domain')) {
        try {
          // 如果域名发生变化，需要先删除旧域名再添加新域名
          if (requestBody.originalDomain && requestBody.originalDomain !== requestBody.domain) {
            await deleteDomainFromKV(env, requestBody.originalDomain);
            
            // 创建新的域名对象（不包含originalDomain字段）
            const newDomainInfo = {
              domain: requestBody.domain,
              registrationDate: requestBody.registrationDate,
              expirationDate: requestBody.expirationDate,
              system: requestBody.system,
              systemURL: requestBody.systemURL,
              remark: requestBody.remark,
              sortOrder: requestBody.sortOrder
            };
            
            await saveDomainToKV(env, newDomainInfo);
          } else {
            // 域名没变，直接更新
            const domainInfo = {
              domain: requestBody.domain,
              registrationDate: requestBody.registrationDate,
              expirationDate: requestBody.expirationDate,
              system: requestBody.system,
              systemURL: requestBody.systemURL,
              remark: requestBody.remark,
              sortOrder: requestBody.sortOrder
            };
            
            await editDomainInKV(env, domainInfo);
          }
          
          return new Response(JSON.stringify({ success: true }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: error.message || '更新域名信息失败'
          }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } else if (url.pathname.endsWith('/save-sort-order')) {
        const domainsKV = env.SECRET_KV;
        const domains = await domainsKV.get('domains') || '[]';
        const domainsArray = JSON.parse(domains);

        requestBody.forEach(({ domain, sortOrder }) => {
          const index = domainsArray.findIndex(d => d.domain === domain);
          if (index !== -1) {
            domainsArray[index].sortOrder = sortOrder;
          }
        });

        await domainsKV.put('domains', JSON.stringify(domainsArray));
        return new Response('排序顺序已保存', { status: 200 });
      }
    }

    // 提取并设置环境变量
    sitename = env.SITENAME || sitename;
    tgid = env.TGID || tgid;
    tgtoken = env.TGTOKEN || tgtoken;
    days = Number(env.DAYS || days);

    // 检查 SECRET_KV 是否定义
    if (!env.SECRET_KV || typeof env.SECRET_KV.get !== 'function') {
      return new Response("SECRET_KV 命名空间未定义或绑定", { status: 500 });
    }
    
    // 检查是否是域名列表页面请求
    if (url.pathname === '/domains') {
      // 验证令牌参数
      const token = url.searchParams.get('token');
      if (!token) {
        return new Response("未授权访问", { status: 401 });
      }
      
      // 验证令牌是否有效
      const isValidToken = await env.SECRET_KV.get('auth_token:' + token);
      if (!isValidToken) {
        return new Response("会话已过期或无效，请重新登录", { status: 401 });
      }
      
      // 从Cloudflare KV中获取最新的 domains 数据
      try {
        const domainsKV = await env.SECRET_KV.get('domains');
        domains = domainsKV ? JSON.parse(domainsKV) : [];
        if (!Array.isArray(domains)) throw new Error('JSON 数据格式不正确');
        domains.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      } catch (error) {
        return new Response("从Cloudflare KV中获取的 JSON 数据格式不正确", { status: 500 });
      }
      
      // 返回域名列表页面
      const htmlContent = await generateDomainListPage(domains, sitename);
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html' },
      });
    } else {
      // 返回密码验证页面
      const htmlContent = await generatePasswordPage();
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  },

  //定时任务，监控域名到期实际发送消息
  async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduled(event,env));
      }

};
