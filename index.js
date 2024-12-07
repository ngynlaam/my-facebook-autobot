const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());

// Configuration Constants
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'A';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'EAAIH7BoieVsBO5bEuPZAq9Jhqesbr2rIZAfxtEtKeCPiGaZBSTgDuDmNcRoqLnwhVZCTLNqKLAOcxvLfUde3oMv3PLQ4jRURDyGp4IyqK5QGXR0z2NyDPknBO7nfehzkFVD60d8HPD7toeSFIAMzqZAy7AopHLT6cO0fZCEBy1jS2G8XumQqyGR1p9miohHvzIyISZAjrnkbnaqXMJYWQZDZD';
const USER_ACCOUNTS_FILE = path.join(__dirname, 'QUIZLET.txt');
const USER_DATE_FILE = path.join(__dirname, 'DATE.txt');
const USER_MESSAGE_COUNT_FILE = path.join(__dirname, 'MESSAGE_COUNT.txt');

/**
 * Webhook Verification Endpoint
 */
app.get('/webhook', (req, res) => {
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (verifyToken === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/**
 * Webhook Event Handling
 */
app.post('/webhook', async (req, res) => {
  const data = req.body;

  if (data.object === 'page') {
    for (const entry of data.entry) {
      for (const event of entry.messaging) {
        const senderId = event.sender.id;

        if (event.message) {
          // Only count messages from the user (not from the page itself)
          if (senderId !== event.recipient.id) {
            // Increment user's message count
            await updateUserMessageCount(senderId);
          }
          await handleMessage(senderId, event.message);
        }
      }
    }
  }

  res.status(200).send('EVENT_RECEIVED');
});

/**
 * Send a Text Message via Facebook API
 */
const sendTextMessage = async (senderId, messageText) => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/me/messages`,
      {
        recipient: { id: senderId },
        message: { text: messageText },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
      }
    );
    console.log(`Sender ID: ${senderId} - Text message sent successfully:`, response.data);
  } catch (error) {
    handleAxiosError(error, 'Text', senderId);
  }
};

/**
 * Handle Axios Errors
 */
const handleAxiosError = (error, type, senderId) => {
  if (error.response) {
    console.error(`Sender ID: ${senderId} - Error response from Facebook API (${type}):`, error.response.data);
  } else {
    console.error(`Sender ID: ${senderId} - Error sending ${type.toLowerCase()} message:`, error.message);
  }
};

/**
 * Check if User Can Request
 */
const canUserRequest = async (senderId) => {
  try {
    const dateData = await fs.readFile(USER_DATE_FILE, 'utf8');
    const userDateData = parseUserData(dateData);

    if (!userDateData[senderId]) {
      // First-time user, allow request
      return { canRequest: true, isFirstTimeUser: true };
    }

    // User exists in DATE.txt
    const lastRequestTime = new Date(userDateData[senderId]);
    const currentTime = new Date();
    const timeDifferenceDays = (currentTime - lastRequestTime) / (1000 * 60 * 60 * 24);
    const waitTimeInDays = 22;

    if (timeDifferenceDays < waitTimeInDays) {
      const remainingTimeInMinutes = Math.ceil((waitTimeInDays - timeDifferenceDays) * 24 * 60);
      return {
        canRequest: false,
        remainingTimeInMinutes,
        lastRequestTime,
      };
    }

    // 22 days have passed, check message count
    const messageCountData = await fs.readFile(USER_MESSAGE_COUNT_FILE, 'utf8');
    const userMessageCounts = parseUserData(messageCountData);
    const totalMessages = parseInt(userMessageCounts[senderId] || '0', 10);

    if (isNaN(totalMessages) || totalMessages > 5) {
      return { canRequest: true };
    } else {
      return { canRequest: false, isSpammer: true };
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Files don't exist; treat as first-time user
      return { canRequest: true, isFirstTimeUser: true };
    }
    throw err;
  }
};

/**
 * Update User's Request Time
 */
const updateUserTime = async (senderId) => {
  try {
    let userData = {};

    try {
      const data = await fs.readFile(USER_DATE_FILE, 'utf8');
      userData = parseUserData(data);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    userData[senderId] = new Date().toISOString();
    const updatedData = formatUserData(userData);
    await fs.writeFile(USER_DATE_FILE, updatedData, 'utf8');
    console.log(`Sender ID: ${senderId} - User request time updated.`);
  } catch (err) {
    console.error(`Sender ID: ${senderId} - Error updating user time:`, err);
    throw err;
  }
};

/**
 * Reset User's Message Count after successful request
 */
const resetUserMessageCount = async (senderId) => {
  try {
    let messageCounts = {};

    try {
      const data = await fs.readFile(USER_MESSAGE_COUNT_FILE, 'utf8');
      messageCounts = parseUserData(data);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    messageCounts[senderId] = '0';
    const updatedData = formatUserData(messageCounts);
    await fs.writeFile(USER_MESSAGE_COUNT_FILE, updatedData, 'utf8');
    console.log(`Sender ID: ${senderId} - User message count reset.`);
  } catch (err) {
    console.error(`Sender ID: ${senderId} - Error resetting user message count:`, err);
    throw err;
  }
};

/**
 * Update User's Message Count
 */
const updateUserMessageCount = async (senderId) => {
  try {
    let messageCounts = {};

    try {
      const data = await fs.readFile(USER_MESSAGE_COUNT_FILE, 'utf8');
      messageCounts = parseUserData(data);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const currentCount = parseInt(messageCounts[senderId] || '0', 10);
    messageCounts[senderId] = currentCount + 1;
    const updatedData = formatUserData(messageCounts);
    await fs.writeFile(USER_MESSAGE_COUNT_FILE, updatedData, 'utf8');
    console.log(`Sender ID: ${senderId} - User message count updated to ${messageCounts[senderId]}.`);
  } catch (err) {
    console.error(`Sender ID: ${senderId} - Error updating user message count:`, err);
    throw err;
  }
};

/**
 * Get User's Message Count
 */
const getUserMessageCount = async (senderId) => {
  try {
    let messageCounts = {};

    try {
      const data = await fs.readFile(USER_MESSAGE_COUNT_FILE, 'utf8');
      messageCounts = parseUserData(data);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    return parseInt(messageCounts[senderId] || '0', 10);
  } catch (err) {
    console.error(`Sender ID: ${senderId} - Error getting user message count:`, err);
    throw err;
  }
};

/**
 * Parse User Data from File
 */
const parseUserData = (data) => {
  return data.split('\n').reduce((acc, line) => {
    const [userId, value] = line.split(' : ');
    if (userId && value) {
      acc[userId] = value;
    }
    return acc;
  }, {});
};

/**
 * Format User Data for File Writing
 */
const formatUserData = (userData) => {
  return Object.entries(userData)
    .map(([userId, value]) => `${userId} : ${value}`)
    .join('\n');
};

/**
 * Open an Account from the Accounts File
 */
const openAccount = async (senderId) => {
  try {
    const data = await fs.readFile(USER_ACCOUNTS_FILE, 'utf8');
    const lines = data.split('\n').filter((line) => line.trim() !== '');

    if (lines.length < 1) {
      console.log(`Sender ID: ${senderId} - No accounts left in the file.`);
      return [];
    }

    const user = lines[0].trim();
    const password = 'Chucbanhoctot';

    const credentials = { user, password };

    // Remove the first account from the file
    const updatedData = lines.slice(1).join('\n');
    await fs.writeFile(USER_ACCOUNTS_FILE, updatedData, 'utf8');
    console.log(`Sender ID: ${senderId} - Account ${user} removed from the file.`);

    return [credentials];
  } catch (err) {
    console.error(`Sender ID: ${senderId} - Error reading accounts file:`, err);
    throw err;
  }
};

/**
 * Handle Incoming Messages
 */
const handleMessage = async (senderId, message) => {
  if (message.text) {
    const text = message.text.trim();

    try {
      if (text === 'SHINESHOP_QUIZLET') {
        await handleQuizletCommand(senderId);
      }
    } catch (error) {
      await sendTextMessage(senderId, 'Đã xảy ra lỗi khi xử lý yêu cầu của bạn. Vui lòng thử lại sau.');
      console.error(`Sender ID: ${senderId} - Error handling message:`, error);
    }
  }
};

/**
 * Handle the SHINESHOP_QUIZLET Command
 */
const handleQuizletCommand = async (senderId) => {
  // Check if the user can request
  const requestStatus = await canUserRequest(senderId);

  if (requestStatus.canRequest) {
    // Proceed to provide account
    try {
      const credentialsList = await openAccount(senderId);

      if (credentialsList.length > 0) {
        const { user, password } = credentialsList[0];

        const messages = [
          '𝐒𝐇𝐈𝐍𝐄 𝐒𝐇𝐎𝐏 gửi bạn tài khoản 𝐐𝐔𝐈𝐙𝐋𝐄𝐓 𝐏𝐋𝐔𝐒 "xấp xỉ" một tháng.\n✅ Tài khoản và mật khẩu lần lượt là:',
          user,
          password,
          '❤️‍🔥 LIKE, FOLLOW và TƯƠNG TÁC là những hành động cần thiết để xây dựng và duy trì page.\n⏳Thời gian chờ cho lần lấy tiếp theo là 22 ngày...',
        ];

        for (const msg of messages) {
          await sendTextMessage(senderId, msg);
        }

        // Update user's last request time
        await updateUserTime(senderId);

        // Reset user's message count
        await resetUserMessageCount(senderId);
      } else {
        await sendTextMessage(senderId, '🛑 Số lượng tài khoản trong kho đã hết. Thử lại sau...');
      }
    } catch (error) {
      await sendTextMessage(senderId, 'Lỗi khi lấy thông tin tài khoản. Vui lòng thử lại sau.');
      console.error(`Sender ID: ${senderId} - Error during account provision:`, error);
    }
  } else {
    if (requestStatus.remainingTimeInMinutes) {
      const { remainingTimeInMinutes, lastRequestTime } = requestStatus;
      const formattedTime = lastRequestTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const message = `🙂‍↔️🫸\nBạn phải chờ ${remainingTimeInMinutes} phút nữa để có thể lấy tài khoản (tính từ lần cuối vào lúc ${formattedTime}).`;
      await sendTextMessage(senderId, message);
    } else if (requestStatus.isSpammer) {
      await sendTextMessage(
        senderId,
        '🚫 STOP! Hãy chụp màn hình đảm bảo bạn đã tương tác với bài viết mới nhất của page!'
      );
    } else {
      await sendTextMessage(senderId, 'Yêu cầu của bạn không thể thực hiện. Vui lòng thử lại sau.');
    }
  }
};

/**
 * Start the Express Server
 */
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
