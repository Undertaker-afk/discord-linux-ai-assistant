import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js'; // Import Discord.js
import Groq from 'groq-sdk';
import unirest from 'unirest';
import mysql from 'mysql2/promise';

const DISCORD_LINUX_API_URL = 'https://api.ssh.surf';
const MAX_ITERATIONS = 5;
const MAX_MESSAGE_LENGTH = 2000; // Discord's character limit per message

// Initialize MySQL connection
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const dbPromise = mysql.createPool(dbConfig);
(async () => {
  const db = await dbPromise;
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    discordId VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255),
    groqApiKey TEXT,
    linuxApiKey TEXT
  )`);
})();

// Initialize the Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
});

// A small helper for nice verbose logging:
function logHeader(message) {
  console.log('\n' + '═'.repeat(80));
  console.log('═ ' + message);
  console.log('═'.repeat(80) + '\n');
}

function logSubHeader(message) {
  console.log('\n' + '-'.repeat(60));
  console.log('> ' + message);
  console.log('-'.repeat(60) + '\n');
}

function logInfo(message) {
  console.log(`INFO: ${message}`);
}

function logCommandStart(cmd) {
  console.log(`\n[EXECUTING COMMAND]\n$ ${cmd}\n`);
}

function logCommandResult(stdout, stderr) {
  if (stdout && stdout.trim().length > 0) {
    console.log("[STDOUT]:\n" + indentMultiline(stdout));
  } else {
    console.log("[STDOUT]: (empty)\n");
  }
  
  if (stderr && stderr.trim().length > 0) {
    console.log("[TERMINAL]:\n" + indentMultiline(stderr));
  } else {
    console.log("[TERMINAL]: (empty)\n");
  }
}

function indentMultiline(text) {
  return text.split('\n').map(line => '  ' + line).join('\n');
}

// Helper to send long messages in parts
async function sendLongMessage(channel, content) {
  const parts = content.match(new RegExp(`.{1,${MAX_MESSAGE_LENGTH}}`, 'g'));
  for (const part of parts) {
    await channel.send(part);
  }
}

// Helper to execute a command in the container:
async function execCommandInContainer(cmd, pwd = '/home', linuxApiKey) {
  const response = await unirest
    .post(`${DISCORD_LINUX_API_URL}/exec`)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-ssh-auth': linuxApiKey
    })
    .send({ cmd, pwd });

  return response.body;
}

// This function queries the AI for instructions. It returns a series of commands to try.
async function askAIForInstructions(context, goal, groqApiKey) {
  const groqClient = new Groq({ apiKey: groqApiKey });

  const systemPrompt = `You are a world-class Linux system administration assistant, given the ability to access and run commands on a remote Debian/Ubuntu-based Linux container. Your mission is to help achieve the following goal: ${goal}. 
Rules:
1. Return only shell commands needed, line-by-line, no explanation.
2. If previous attempts failed, refine your approach and fix the issues based on the provided errors and output.
3. If you need to run multiple commands, separate them by new lines.
4. Consider common steps: updating package lists, installing packages, verifying installation.
5. The container might be minimal, so consider installing or fixing repositories if needed.
6. Always ensure commands are non-interactive.
7. Do not use markdown formatting at all ever.
8. All commands are non-interactive
9. If installing packages, always use -y to allow for non-interactive commands
`;

  const userPrompt = `CONTEXT:\n${context}\n\nPlease provide the exact shell commands to achieve the goal above.`;

  const params = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    model: 'llama3-8b-8192',
  };

  const chatCompletion = await groqClient.chat.completions.create(params);
  const aiResponse = chatCompletion.choices[0].message.content.trim();
  return aiResponse;
}

function parseCommandsFromAIResponse(aiResponse) {
  const lines = aiResponse.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines;
}

// Listen for messages on Discord
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;  // Ignore bot messages

  const db = dbPromise;
  const [userRows] = await db.query('SELECT * FROM users WHERE discordId = ?', [message.author.id]);
  const user = userRows[0];

  if (!user) {
    // Send DM to new user
    try {
      const dm = await message.author.send("Welcome! Please provide your API keys in the following format:\n\nGROQ API Key: <your-groq-api-key>\nLinux API Key: <your-linux-api-key>");
      const filter = (m) => m.author.id === message.author.id;
      const collected = await dm.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });

      const keys = collected.first().content.match(/GROQ API Key: (.+)\nLinux API Key: (.+)/);
      if (keys) {
        const [, groqApiKey, linuxApiKey] = keys;
        await db.query('INSERT INTO users (discordId, username, groqApiKey, linuxApiKey) VALUES (?, ?, ?, ?)', [
          message.author.id, message.author.username, groqApiKey, linuxApiKey
        ]);
        await message.author.send("Your API keys have been saved successfully!");
      } else {
        await message.author.send("Invalid format. Please try again.");
      }
    } catch (err) {
      console.error("Error collecting API keys: ", err);
      message.author.send("An error occurred while collecting your API keys. Please try again later.");
    }
    return;
  }

  if (message.content.startsWith('!goal')) {
    // Extract the goal from the command
    const goal = message.content.slice(6).trim();
    if (!goal) {
      message.reply("Please specify a goal after the command, e.g., `!goal install nginx`.");
      return;
    }

    let context = "Initial attempt. No commands have been run yet.\n" +
                  "We are working with a Debian/Ubuntu container.\n" +
                  "Goal: " + goal;

    logHeader(`STARTING PROCESS TO ACHIEVE GOAL: ${goal}`);
    
    let iteration = 0;
    let success = false;
    let fullLog = "";

    while (iteration < MAX_ITERATIONS && !success) {
      iteration++;
      logHeader(`ITERATION ${iteration} OF ${MAX_ITERATIONS}`);
      
      logSubHeader('Asking AI for instructions');
      const instructions = await askAIForInstructions(context, goal, user.groqApiKey);
      console.log("AI PROVIDED COMMANDS:\n" + indentMultiline(instructions));

      const commands = parseCommandsFromAIResponse(instructions);
      let allCommandsSucceeded = true;
      let attemptLog = `Attempt #${iteration}:\n**AI instructions:**\n\n\`\`\`bash\n${instructions}\n\`\`\`\n\n**Command results:**\n\n`;

      for (const cmd of commands) {
        logCommandStart(cmd);
        const result = await execCommandInContainer(cmd, '/home', user.linuxApiKey);
        const stdout = result.stdout || '';
        const stderr = result.stderr || '';
        logCommandResult(stdout, stderr);

        attemptLog += `\n> ${cmd}\n\`\`\`plaintext\nstdout:\n${stdout}\n\nTerminal:\n${stderr}\n\`\`\`\n`;

        if (stderr && stderr.trim().length > 0) {
          logInfo(`Command failed with error detected in Terminal. Will request refined instructions next iteration.`);
          allCommandsSucceeded = false;
          break;
        } else {
          logInfo(`Command executed successfully.`);
        }
      }

      context += `\n\n${attemptLog}`;
      fullLog += attemptLog;

      if (allCommandsSucceeded) {
        logInfo("All commands executed successfully.");
        success = true;
      } else {
        logInfo("At least one command failed. The AI will refine approach in next iteration.");
      }
    }

    if (success) {
      logHeader("SUCCESS! The goal appears to have been achieved.");
      await sendLongMessage(message.channel, `The goal was successfully achieved.\n\n**Logs:**\n\n${fullLog}`);
    } else {
      logHeader("FAILURE TO ACHIEVE GOAL WITHIN MAX ITERATIONS");
      await sendLongMessage(message.channel, `Failed to achieve the goal within the maximum number of iterations.\n\n**Logs:**\n\n${fullLog}`);
    }
  }
});

// Log in to Discord with your app's token
client.login(process.env['DISCORD_TOKEN']).catch(err => {
  console.error("Error logging in:", err);
});
