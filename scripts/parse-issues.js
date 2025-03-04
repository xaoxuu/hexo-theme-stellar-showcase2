import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './utils.js';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

async function getIssues() {
  const config = loadConfig('issue_parser');
  const [owner, repo] = (config.repo || process.env.GITHUB_REPOSITORY).split('/');
  const params = {
    owner,
    repo,
    state: 'all'
  };

  // 添加标签筛选
  if (config.label) {
    params.labels = config.label;
  }

  // 添加排序
  if (config.sort === 'updated-desc') {
    params.sort = 'updated';
    params.direction = 'desc';
  } else {
    // 默认按创建时间排序
    params.sort = 'created';
    params.direction = 'desc';
  }

  const { data: issues } = await octokit.issues.listForRepo(params);
  return issues;
}

async function parseIssues() {
  if (!loadConfig('issue_parser').enabled) {
    console.log('Issue parser is disabled in config');
    return;
  }

  try {
    const issues = await getIssues();
    const parsedData = {
      version: 'v2',
      content: []
    };

    for (const issue of issues) {
      try {
        // 查找issue内容中的第一个JSON对象
        const match = issue.body.match(/\{[^\}]*\}/m);
        if (match) {
          const jsonData = JSON.parse(match[0]);
          // 添加issue编号以便后续关联，但不保存到输出文件中
          const issueNumber = issue.number;
          // 删除issue_number字段
          delete jsonData.issue_number;
          parsedData.content.push(jsonData);
          
          // 处理无效示例的自动关闭
          const config = loadConfig('issue_parser');
          if (config.auto_close && config.invalid_label) {
            const labels = issue.labels.map(label => label.name);
            if (labels.includes(config.invalid_label)) {
              const [owner, repo] = (config.repo || process.env.GITHUB_REPOSITORY).split('/');
              await octokit.issues.update({
                owner,
                repo,
                issue_number: issueNumber,
                state: 'closed'
              });
              console.log(`Closed invalid issue #${issueNumber}`);
            }
          }
        }
      } catch (error) {
        console.error(`Error parsing JSON from issue #${issue.number}:`, error);
      }
    }

    // 确保输出目录存在
    const outputDir = path.join(process.cwd(), 'v2');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 将解析后的数据写入v2/data.json文件
    const outputPath = path.join(outputDir, 'data.json');
    fs.writeFileSync(outputPath, JSON.stringify(parsedData, null, 2));
    console.log('Successfully generated v2/data.json');

  } catch (error) {
    console.error('Error processing issues:', error);
    process.exit(1);
  }
}

parseIssues();