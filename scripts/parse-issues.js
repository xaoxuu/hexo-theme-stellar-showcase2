import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { loadConfig, logger, handleError, writeJsonToFile } from './utils.js';
import { PATHS } from './constants.js';
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

  try {
    const { data: issues } = await octokit.issues.listForRepo(params);
    return issues;
  } catch (error) {
    handleError(error, 'Error fetching issues');
    throw error;
  }
}

async function processIssue(issue, config) {
  try {
    logger('info', `Processing issue #${issue.number}`);
    if (!issue.body) {
      logger('warn', `Issue #${issue.number} has no body content, skipping...`);
      return null;
    }

    const match = issue.body.match(/```json\s*\{[\s\S]*?\}\s*```/m);
    const jsonMatch = match ? match[0].match(/\{[\s\S]*?\}/m) : null;

    if (!jsonMatch) {
      logger('warn', `No JSON content found in issue #${issue.number}`);
      return null;
    }

    logger('info', `Found JSON content in issue #${issue.number}`);
    const jsonData = JSON.parse(jsonMatch[0]);
    jsonData.issue_number = issue.number;

    // 处理无效示例的自动关闭
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
        logger('info', `Closed invalid issue #${issue.number}`);
      }
    }

    return jsonData;
  } catch (error) {
    handleError(error, `Error processing issue #${issue.number}`);
    return null;
  }
}

async function parseIssues() {
  const config = loadConfig('issue_parser');
  if (!config.enabled) {
    logger('info', 'Issue parser is disabled in config');
    return;
  }

  try {
    const issues = await getIssues();
    logger('info', `Found ${issues.length} issues to process`);

    const parsedData = {
      version: 'v2',
      content: []
    };

    for (const issue of issues) {
      const processedData = await processIssue(issue, config);
      if (processedData) {
        parsedData.content.push(processedData);
      }
    }

    const outputPath = path.join(process.cwd(), PATHS.DATA);
    if (writeJsonToFile(outputPath, parsedData)) {
      logger('info', 'Successfully generated v2/data.json');
    }

  } catch (error) {
    handleError(error, 'Error processing issues');
    process.exit(1);
  }
}

parseIssues();
