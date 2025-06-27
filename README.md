# domain-check-new
这是一个简洁高效的域名可视化展示面板，基于Cloudflare Workers构建。它提供了一个直观的界面，让用户能够一目了然地查看他们域名的状态、注册商、注册日期、过期日期和使用进度，并可在到期前通过TG机器人向用户推送通知。

## 项目基于[yutian81的项目](https://github.com/yutian81/domain-check)进行完善，增加了密码登录、编辑删除功能

**原版DEMO**：<https://domains.yutian81.top>  

**当前版本效果图**

![Snipaste_2025-03-02_11-11-31](https://github.com/user-attachments/assets/0fb1e39e-53dc-43ae-aeac-1ebda2450c89)


## 2025-05-03 更新。再次立flag，不再新增功能
- 增加了排序字段，默认新增域名排在最后，也可以新增时候指定序号。
- 增加了备注字段，方便记录域名使用内容
- 优化了背景图获取逻辑，现在获取bing每日图片
- 增加新的登录方式，https://你的域名?password=你设置的密码
  
## 2025-03-01 更新：修复了密码检验逻辑，重构了页面加载顺序，增加了域名编辑和删除功能
- 上一版密码会提前加载到源代码中，存在安全隐患，已重构代码
- 之前想实现的编辑功能，也重新实现
- 目前应该是最终版，只作为个人域名信息记录，再多的功能，维护也是一个问题。所以就先这样了

## 2025-02-26 更新：增加了密码登录校验，将DOMAINS参数改为变量绑定方式配置，不再使用GitHub的json文件方式
- 创建一个KV命令空间：名称SECRET_KV
- 在 workers 或 pages 的设置里，绑定 kv 空间，变量名为`SECRET_KV`（不能修改），绑定上一步中新建的 kv 空间（SECRET_KV）
- 在cf的存储和数据库-->KV --> 点开SECRET_KV，在KV对中，新增一对数据，key（密钥）名password，value（值）为你想要设置的密码。

## 2024-11-11 更新：每天只进行一次 TG 通知
- 创建一个KV命令空间：名称随意，假设为`DOMAINS_TG_KV`
- 在 workers 或 pages 的设置里，绑定 kv 空间，变量名为`DOMAINS_TG_KV`（不能修改），绑定上一步中新建的 kv 空间

## 部署方法

**worker 部署**

   **创建workers 项目**
   
  - 在cf中创建一个workers，项目名看你个人习惯定义，复制_worker.js中的代码到workers中，点击保存并部署。
    
![sp20250301_140227_057](https://github.com/user-attachments/assets/d67bf4ba-3419-4318-8754-aefcfeb42bb0)


   **创建KV 空间**
   
   - 回到cf账号首页，在cf的左侧菜单中-->存储和数据库-->KV -->创建两个KV命令空间：名称SECRET_KV 和 DOMAINS_TG_KV
   - 点开SECRET_KV，在KV对中，新增两对数据，key（密钥）名password，value（值）为你想要设置的密码。
    
![sp20250301_140349_095](https://github.com/user-attachments/assets/a96b1cc9-da0f-4ef8-a81b-8326f33b43a2)
    
   ![sp20250301_140528_053](https://github.com/user-attachments/assets/0d4edbbf-5e58-48dc-9bea-cc32909b83d4)


    
| 密钥 | 值 | 说明 | 是否必填 | 
| ------ | ------- | ------ | ------ |
| password | 你想设置的密码字符串 | 看你个人喜好 ，简单复杂都行 | 是 |
| domains | 你准备监控的域名信息 | json体格式的数据，具体见下面示例。也可以后续从前端页面直接维护，但初始化要先维护一条 | 是 |

   **绑定KV 空间**
   
  - 在第一步创建的项目里--> 设置，绑定菜单，添加 kv 空间，变量名为`SECRET_KV` 和 DOMAINS_TG_KV（两个变量名不能修改），绑定上一步中新建的 kv 空间（SECRET_KV和DOMAINS_TG_KV）
   ![image](https://github.com/user-attachments/assets/bfad0d9c-e636-4dd0-804e-e828a3f6fc53)

  **创建变量设置**

  - 还是在设置菜单，点击变量和机密，添加以下变量名：
   
| 变量名 | 填写示例 | 说明 | 是否必填 | 
| ------ | ------- | ------ | ------ |
| SITENAME | 我的域名监控 | 自定义站点名称，默认为`域名监控` | 否 |
| TGID | 652***4200 | TG机器人ID，不需要通知可不填 | 否 |
| TGTOKEN | 60947***43:BBCrcW-uKM7p8 | TG机器人TOKEN，不需要通知可不填 | 否 |
| DAYS | 7 | 提前几天发送TG提醒，必须是整数，默认为`7` | 否 |

**设置定时任务**

- 还是在设置菜单，点击触发事件，添加一个事件。选择Cron触发器，填入表达式
- Cron表达式 0 1 * * *（UTC时间1:00）对应的中国时间是 每天上午9:00。cf是UTC时间。所以想要在国内白天提醒，要把国内时间-8小时。
- CF的表达式是5段式，左边第一位表示分钟。各位如果有其他需求，自行修改。
- 域名到期时间的刷新也是以UTC时间为计算基准。

![sp20250302_112243_945](https://github.com/user-attachments/assets/4863af51-38dd-4301-ad2b-ca877ffd16e3)


## 域名信息json格式
**示例**
```
[
  { "domain": "883344.best", "registrationDate": "2024-06-16", "expirationDate": "2025-07-15", "system": "SpaceShip", "systemURL": "https://www.spaceship.com/zh" },
  { "domain": "711911.xyz", "registrationDate": "2024-04-16", "expirationDate": "2029-04-15", "system": "SpaceShip", "systemURL": "https://www.spaceship.com/zh" },
  { "domain": "hello.xyz", "registrationDate": "2024-07-17", "expirationDate": "2025-07-16", "system": "SpaceShip", "systemURL": "https://www.spaceship.com/zh" }
]
```

## 技术和服务支持
感谢EdgeOne提供的cdn支持。
![34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b](https://github.com/user-attachments/assets/9dac04bb-f29e-4b27-afb2-17902059ed9f)

[亚洲最佳CDN、边缘和安全解决方案 - Tencent EdgeOne]([https://github.com/ypq123456789/domainkeeper](https://edgeone.ai/zh?from=github))

## 致谢
[ypq123456789](https://github.com/ypq123456789/domainkeeper)
