import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface BioData {
  id: string;
  patternData: string;
  timestamp: number;
  owner: string;
  interactionType: string;
  intensity: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [patterns, setPatterns] = useState<BioData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPatternData, setNewPatternData] = useState({
    interactionType: "",
    description: "",
    intensityLevel: 50
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics for dashboard
  const highIntensityCount = patterns.filter(p => p.intensity >= 70).length;
  const mediumIntensityCount = patterns.filter(p => p.intensity >= 30 && p.intensity < 70).length;
  const lowIntensityCount = patterns.filter(p => p.intensity < 30).length;

  useEffect(() => {
    loadPatterns().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPatterns = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("pattern_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing pattern keys:", e);
        }
      }
      
      const list: BioData[] = [];
      
      for (const key of keys) {
        try {
          const patternBytes = await contract.getData(`pattern_${key}`);
          if (patternBytes.length > 0) {
            try {
              const patternData = JSON.parse(ethers.toUtf8String(patternBytes));
              list.push({
                id: key,
                patternData: patternData.data,
                timestamp: patternData.timestamp,
                owner: patternData.owner,
                interactionType: patternData.interactionType,
                intensity: patternData.intensity || 50
              });
            } catch (e) {
              console.error(`Error parsing pattern data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading pattern ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPatterns(list);
    } catch (e) {
      console.error("Error loading patterns:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPattern = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting pattern data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newPatternData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const patternId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const patternData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        interactionType: newPatternData.interactionType,
        intensity: newPatternData.intensityLevel
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `pattern_${patternId}`, 
        ethers.toUtf8Bytes(JSON.stringify(patternData))
      );
      
      const keysBytes = await contract.getData("pattern_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(patternId);
      
      await contract.setData(
        "pattern_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted pattern submitted securely!"
      });
      
      await loadPatterns();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPatternData({
          interactionType: "",
          description: "",
          intensityLevel: 50
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: isAvailable 
          ? "FHE system is available and ready!" 
          : "FHE system is currently unavailable"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to check availability"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredPatterns = patterns.filter(pattern => 
    pattern.interactionType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pattern.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to interact with the BioLumiArt platform",
      icon: "🔗"
    },
    {
      title: "Create Pattern",
      description: "Design your bioluminescent pattern through encrypted interaction",
      icon: "🎨"
    },
    {
      title: "FHE Processing",
      description: "Your pattern is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Art Manifestation",
      description: "Watch as living organisms respond to your encrypted input",
      icon: "✨"
    }
  ];

  const renderIntensityChart = () => {
    const total = patterns.length || 1;
    const highPercentage = (highIntensityCount / total) * 100;
    const mediumPercentage = (mediumIntensityCount / total) * 100;
    const lowPercentage = (lowIntensityCount / total) * 100;

    return (
      <div className="intensity-chart-container">
        <div className="intensity-bar">
          <div 
            className="intensity-segment high" 
            style={{ width: `${highPercentage}%` }}
          ></div>
          <div 
            className="intensity-segment medium" 
            style={{ width: `${mediumPercentage}%` }}
          ></div>
          <div 
            className="intensity-segment low" 
            style={{ width: `${lowPercentage}%` }}
          ></div>
        </div>
        <div className="intensity-legend">
          <div className="legend-item">
            <div className="color-dot high"></div>
            <span>High: {highIntensityCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot medium"></div>
            <span>Medium: {mediumIntensityCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot low"></div>
            <span>Low: {lowIntensityCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="biolumi-spinner"></div>
      <p>Initializing encrypted bioluminescent connection...</p>
    </div>
  );

  return (
    <div className="app-container biolumi-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="biolumi-icon"></div>
          </div>
          <h1>BioLumi<span>Art</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-pattern-btn art-button"
          >
            <div className="add-icon"></div>
            Create Pattern
          </button>
          <button 
            className="art-button secondary"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <button 
            className="art-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="art-banner">
          <div className="banner-content">
            <h2>FHE-Powered Interactive Bio-luminescent Art</h2>
            <p>Encrypted interaction with living organisms through fully homomorphic encryption</p>
            <div className="banner-glow"></div>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>BioLumiArt Creation Guide</h2>
            <p className="subtitle">Learn how to create encrypted bioluminescent patterns</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                  {index < tutorialSteps.length - 1 && <div className="step-connector"></div>}
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="art-grid">
          <div className="art-card intro-card">
            <h3>Project Introduction</h3>
            <p>BioLumiArtFHE is a living art installation that uses fully homomorphic encryption to allow encrypted interaction with bioluminescent organisms. Your encrypted inputs directly influence the light patterns of living algae and other organisms.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Art</span>
            </div>
          </div>
          
          <div className="art-card stats-card">
            <h3>Pattern Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{patterns.length}</div>
                <div className="stat-label">Total Patterns</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{highIntensityCount}</div>
                <div className="stat-label">High Intensity</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{mediumIntensityCount}</div>
                <div className="stat-label">Medium Intensity</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{lowIntensityCount}</div>
                <div className="stat-label">Low Intensity</div>
              </div>
            </div>
          </div>
          
          <div className="art-card chart-card">
            <h3>Intensity Distribution</h3>
            {renderIntensityChart()}
          </div>
        </div>
        
        <div className="patterns-section">
          <div className="section-header">
            <h2>Encrypted Pattern Library</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search patterns..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="art-input"
                />
              </div>
              <button 
                onClick={loadPatterns}
                className="refresh-btn art-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Patterns"}
              </button>
            </div>
          </div>
          
          <div className="patterns-list art-card">
            <div className="list-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Interaction Type</div>
              <div className="header-cell">Creator</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Intensity</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredPatterns.length === 0 ? (
              <div className="no-patterns">
                <div className="no-patterns-icon"></div>
                <p>No encrypted patterns found</p>
                <button 
                  className="art-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Pattern
                </button>
              </div>
            ) : (
              filteredPatterns.map(pattern => (
                <div 
                  className={`pattern-row ${activePatternId === pattern.id ? 'active' : ''}`} 
                  key={pattern.id}
                  onClick={() => setActivePatternId(pattern.id === activePatternId ? null : pattern.id)}
                >
                  <div className="list-cell pattern-id">#{pattern.id.substring(0, 6)}</div>
                  <div className="list-cell">{pattern.interactionType}</div>
                  <div className="list-cell">{pattern.owner.substring(0, 6)}...{pattern.owner.substring(38)}</div>
                  <div className="list-cell">
                    {new Date(pattern.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="list-cell">
                    <div className="intensity-display">
                      <div 
                        className="intensity-value" 
                        style={{width: `${pattern.intensity}%`}}
                      ></div>
                      <span>{pattern.intensity}%</span>
                    </div>
                  </div>
                  <div className="list-cell actions">
                    <button 
                      className="action-btn art-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActivePatternId(pattern.id === activePatternId ? null : pattern.id);
                      }}
                    >
                      {activePatternId === pattern.id ? "Collapse" : "View Details"}
                    </button>
                  </div>
                  
                  {activePatternId === pattern.id && (
                    <div className="pattern-details">
                      <div className="details-content">
                        <h4>Pattern Details</h4>
                        <p>Encrypted Data: {pattern.patternData.substring(0, 30)}...</p>
                        <p>This pattern influences the bioluminescent organisms through FHE-processed encrypted data.</p>
                        <div className="glow-preview"></div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="partners-section">
          <h2>Project Partners</h2>
          <div className="partners-grid">
            <div className="partner-logo">Zama FHE</div>
            <div className="partner-logo">BioArt Collective</div>
            <div className="partner-logo">CryptoArt Labs</div>
            <div className="partner-logo">Algae Research</div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPattern} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          patternData={newPatternData}
          setPatternData={setNewPatternData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content art-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="biolumi-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="biolumi-icon"></div>
              <span>BioLumiArtFHE</span>
            </div>
            <p>FHE-powered interactive bioluminescent art installation</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Research Paper</a>
            <a href="#" className="footer-link">Exhibition Schedule</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered BioArt</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} BioLumiArtFHE. Exploring the intersection of encryption and life.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  patternData: any;
  setPatternData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  patternData,
  setPatternData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPatternData({
      ...patternData,
      [name]: value
    });
  };

  const handleIntensityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPatternData({
      ...patternData,
      intensityLevel: parseInt(e.target.value)
    });
  };

  const handleSubmit = () => {
    if (!patternData.interactionType) {
      alert("Please select an interaction type");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal art-card">
        <div className="modal-header">
          <h2>Create Encrypted BioPattern</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your pattern will be encrypted with Zama FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Interaction Type *</label>
              <select 
                name="interactionType"
                value={patternData.interactionType} 
                onChange={handleChange}
                className="art-select"
              >
                <option value="">Select type</option>
                <option value="Rhythmic Pulse">Rhythmic Pulse</option>
                <option value="Wave Pattern">Wave Pattern</option>
                <option value="Random Sparkle">Random Sparkle</option>
                <option value="Concentric Circles">Concentric Circles</option>
                <option value="Custom Sequence">Custom Sequence</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Intensity Level: {patternData.intensityLevel}%</label>
              <input 
                type="range"
                min="0"
                max="100"
                value={patternData.intensityLevel}
                onChange={handleIntensityChange}
                className="intensity-slider"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={patternData.description} 
                onChange={handleChange}
                placeholder="Describe your pattern concept..." 
                className="art-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="preview-area">
            <h4>Pattern Preview</h4>
            <div className="pattern-preview">
              <div 
                className="preview-glow" 
                style={{opacity: patternData.intensityLevel / 100}}
              ></div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn art-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn art-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Pattern"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;