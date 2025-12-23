const express = require('express');
const path = require('path');
const chalk = require('chalk');
const open = require('open');
const AuthService = require('../services/auth');
const ApiService = require('../services/api');
const fs = require('fs');
const inquirer = require('inquirer');
const projectx = process.cwd();
const envPath = path.join(projectx, '.env');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const chokidar = require('chokidar');
const archiver = require('archiver');

