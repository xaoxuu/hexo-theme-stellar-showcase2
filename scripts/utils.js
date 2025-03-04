import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// 读取配置文件
export function loadConfig(section) {
  try {
    const configPath = path.join(process.cwd(), 'config.yml');
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    return section ? (config[section] || {}) : config;
  } catch (error) {
    console.error('Error loading config:', error);
    return {};
  }
}