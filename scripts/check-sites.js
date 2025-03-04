import { Octokit } from '@octokit/rest';
import axios from 'axios';
import cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './utils.js';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

async function checkSite(url) {
  const config = loadConfig();
  try {
    const response = await axios.get(url, {
      timeout: config.timeout || 10000
    });
    const $ = cheerio.load(response.data);
    const themeMetaTag = $('meta[name="hexo-theme"]');
    
    if (themeMetaTag.length > 0) {
      const themeName = themeMetaTag.attr('theme-name');
      const themeVersion = themeMetaTag.attr('theme-version');
      
      if (themeName === 'Stellar') {
        return { status: 'stellar', version: themeVersion };
      } else {
        return { status: 'not_stellar' };
      }
    } else {
      return { status: 'not_stellar' };
    }
  } catch (error) {
    console.error(`Error checking site ${url}:`, error);
    return { status: 'error' };
  }
}

async function updateIssueLabels(owner, repo, issueNumber, labels) {
  try {
    await octokit.issues.setLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels
    });
  } catch (error) {
    console.error(`Error updating labels for issue #${issueNumber}:`, error);
  }
}

async function processData() {
  const config = loadConfig();
  if (!config.enabled) {
    console.log('Site checker is disabled in config');
    return;
  }

  try {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const dataPath = path.join(process.cwd(), 'v2', 'data.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    for (const item of data.content) {
      if (item.url) {
        console.log(`Checking site: ${item.url}`);
        let result;
        for (let i = 0; i < (config.retry_times || 3); i++) {
          result = await checkSite(item.url);
          if (result.status !== 'error') break;
          if (i < (config.retry_times || 3) - 1) {
            console.log(`Retrying ${item.url}... (${i + 1}/${config.retry_times || 3})`);
          }
        }
        
        let labels = [];
        switch (result.status) {
          case 'stellar':
            labels = [`Stellar ${result.version}`];
            break;
          case 'not_stellar':
            labels = ['NOT Stellar'];
            break;
          case 'error':
            labels = ['NETWORK ERROR'];
            break;
        }
        
        await updateIssueLabels(owner, repo, item.issue_number, labels);
      }
    }
  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

processData();