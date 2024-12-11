# Discord Linux Administration Bot

A Discord bot designed to automate Linux administration tasks within a containerized Debian/Ubuntu environment using AI-generated commands. This bot communicates with external APIs and databases for user authentication and task execution.

## Features

- **Dynamic Task Execution:**
  - Users provide goals, and the bot queries an AI to generate and execute Linux commands.
  - Automatic retries with refined commands based on previous errors.
- **User Management:**
  - Securely collects and stores user API keys.
  - Links users to their Discord accounts for personalized interactions.
- **Log Handling:**
  - Detailed logs of command execution are sent back to the user in Discord.
  - Commands and outputs are properly formatted for readability.

## Prerequisites

1. **Environment Variables:**
   Ensure the following variables are set in your `.env` file:

   ```env
   DISCORD_TOKEN=your_discord_bot_token
   DB_HOST=your_database_host
   DB_USER=your_database_user
   DB_PASSWORD=your_database_password
   DB_NAME=your_database_name
   ```

2. **MySQL Database:**
   Create a MySQL database with the specified credentials and ensure it is accessible.

3. **APIs:**
   - **Linux API:** Accessible at `https://api.ssh.surf`.
   - **GROQ AI API:** Requires valid API keys for chat-based completions.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Bot

```bash
node bot.js
```

## Usage

1. **Register API Keys:**
   - New users will be prompted in a private message to provide their API keys in the following format:

     ```plaintext
     GROQ API Key: <your-groq-api-key>
     Linux API Key: <your-linux-api-key>
     ```

2. **Set a Goal:**
   - In any channel the bot has access to, use:

     ```plaintext
     !goal <your-goal>
     ```
   - Example:
     ```plaintext
     !goal install nginx
     ```

3. **Receive Results:**
   - The bot will execute the necessary commands and send detailed logs in response.

## Code Highlights

- **Database Management:**
  - Creates a `users` table if it doesn't exist.
- **Command Execution:**
  - Interacts with the Linux API for secure command execution.
- **Error Handling:**
  - Automatically retries tasks with refined commands if errors are encountered.

## Security

- **API Key Storage:**
  - API keys are stored in a MySQL database.
  - Ensure the database is secured and only accessible by the bot.
- **Command Restrictions:**
  - The bot operates within a controlled container environment to prevent unintended modifications to the host system.

## Troubleshooting

- **Bot Login Issues:**
  - Check the `DISCORD_TOKEN` in your `.env` file.
- **Database Errors:**
  - Verify the database credentials and ensure the MySQL service is running.
- **Command Failures:**
  - Check the logs sent by the bot for specific error messages and refine the goal if needed.

## Contributing

Feel free to open issues or submit pull requests for improvements or bug fixes.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
