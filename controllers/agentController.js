const formidable = require('formidable');
const { BlobServiceClient } = require('@azure/storage-blob');
const Agent = require('../models/Agent');
const { v4: uuidv4 } = require('uuid');

// Azure Blob Storage Configuration
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = 'agentfiles'; // Replace with your Azure Blob container name

// Azure Blob Service Client Initialization
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(containerName);

// Ensure the container exists (create it if it doesn't)
(async () => {
  try {
    await containerClient.createIfNotExists();
    console.log(`Container "${containerName}" is ready.`);
  } catch (error) {
    console.error(`Error ensuring container exists: ${error.message}`);
  }
})();

// Utility function to upload file to Azure Blob Storage
const uploadToAzure = async (file, blobName) => {
  try {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const stream = file.filepath ? fs.createReadStream(file.filepath) : file;
    await blockBlobClient.uploadStream(stream, file.size, undefined, {
      blobHTTPHeaders: { blobContentType: file.mimetype },
    });
    console.log(`File uploaded to Azure: ${blobName}`);
    return blockBlobClient.url; // Return the URL of the uploaded file
  } catch (error) {
    console.error('Error uploading to Azure:', error.message);
    throw new Error('Error uploading file to Azure');
  }
};

// Create a new agent
exports.createAgent = async (req, res) => {
  const form = new formidable.IncomingForm();
  form.keepExtensions = true;

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({ message: 'Error parsing form data', error: err.message });
    }

    try {
      // Parse and validate fields
      const agentData = {};
      Object.keys(fields).forEach((key) => {
        agentData[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
      });

      const requiredFields = ['firstName', 'lastName', 'email', 'mobileNumber', 'gender', 'dateOfBirth'];
      for (const field of requiredFields) {
        if (!agentData[field]) {
          return res.status(400).json({ message: `Missing required field: ${field}` });
        }
      }

      // Check duplicates
      const emailExists = await Agent.findOne({ email: agentData.email });
      if (emailExists) return res.status(400).json({ message: 'Email already exists' });

      const mobileExists = await Agent.findOne({ mobileNumber: agentData.mobileNumber });
      if (mobileExists) return res.status(400).json({ message: 'Mobile number already exists' });

      // Upload files to Azure Blob Storage
      const documentUploads = {};
      for (const [key, file] of Object.entries(files)) {
        if (!file.filepath) continue; // Skip invalid files
        const blobName = `${key}-${uuidv4()}`;
        const fileUrl = await uploadToAzure(file, blobName);
        documentUploads[`${key}FilePath`] = fileUrl;
      }

      // Save new agent
      const newAgent = new Agent({
        ...agentData,
        ...documentUploads,
        agentId: uuidv4(),
      });
      const savedAgent = await newAgent.save();

      res.status(201).json({ message: 'Agent created successfully', agent: savedAgent });
    } catch (error) {
      console.error('Error creating agent:', error);
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  });
};

// Get all agents
exports.getAgents = async (req, res) => {
  try {
    const agents = await Agent.find();
    res.status(200).json(agents);
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ message: 'Internal Server Error', error });
  }
};

// Get a specific agent by ID
exports.getAgentById = async (req, res) => {
  try {
    const { id } = req.params;
    const agent = await Agent.findById(id);

    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    res.status(200).json(agent);
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ message: 'Internal Server Error', error });
  }
};

// Update an agent
exports.updateAgent = async (req, res) => {
  const form = new formidable.IncomingForm();
  form.keepExtensions = true;

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({ message: 'Error parsing form data', error: err.message });
    }

    try {
      const { id } = req.params;

      const existingAgent = await Agent.findById(id);
      if (!existingAgent) {
        return res.status(404).json({ message: 'Agent not found' });
      }

      // Upload new files to Azure Blob Storage
      const documentUploads = {};
      for (const [key, file] of Object.entries(files)) {
        if (!file.filepath) continue;
        const blobName = `${key}-${uuidv4()}`;
        const fileUrl = await uploadToAzure(file, blobName);
        documentUploads[`${key}FilePath`] = fileUrl;
      }

      // Update agent in the database
      const updatedData = { ...fields, ...documentUploads };
      const updatedAgent = await Agent.findByIdAndUpdate(id, updatedData, { new: true });

      res.status(200).json({ message: 'Agent updated successfully', agent: updatedAgent });
    } catch (error) {
      console.error('Error updating agent:', error);
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  });
};

// Delete an agent
exports.deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedAgent = await Agent.findByIdAndDelete(id);

    if (!deletedAgent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    res.status(200).json({ message: 'Agent deleted successfully' });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({ message: 'Internal Server Error', error });
  }
};
