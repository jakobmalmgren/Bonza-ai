export const sendResponse = (statusCode, message) => {
  return {
    statusCode,
    body: JSON.stringify(message),
  };
};
