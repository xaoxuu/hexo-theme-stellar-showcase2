import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './utils.js';
import fetch from 'node-fetch';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: { fetch }
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
    console.log(`Found ${issues.length} issues to process`);
    const parsedData = {
      version: 'v2',
      content: []
    };

    for (const issue of issues) {
      try {
        console.log(`Processing issue #${issue.number}`);
        if (!issue.body) {
          console.log(`Issue #${issue.number} has no body content, skipping...`);
          continue;
        }
        // 使用更健壮的正则表达式匹配JSON对象
        const match = issue.body.match(/\{[\s\S]*?\}/m);
        if (match) {
          console.log(`Found JSON content in issue #${issue.number}`);
          const jsonData = JSON.parse(match[0]);
          // 添加issue编号以便后续关联
          jsonData.issue_number = issue.number;
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
                issue_number: issue.number,
                state: 'closed'
              });
              console.log(`Closed invalid issue #${issue.number}`);
            }
          }
        } else {
          console.log(`No JSON content found in issue #${issue.number}`);
        }
      } catch (error) {
        console.error(`Error processing issue #${issue.number}:`, error.message);
        console.error('Issue body:', issue.body);
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
