// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BioluminescentArt_FHE is SepoliaConfig {
    struct EncryptedInteraction {
        uint256 visitorId;
        euint32 encryptedPositionX;
        euint32 encryptedPositionY;
        euint32 encryptedIntensity;
        euint32 encryptedDuration;
        uint256 timestamp;
    }

    struct DecryptedInteraction {
        uint32 positionX;
        uint32 positionY;
        uint32 intensity;
        uint32 duration;
        bool isRevealed;
    }

    struct LightPattern {
        euint32 patternIntensity;
        euint32 patternFrequency;
        euint32 patternDuration;
    }

    uint256 public visitorCount;
    mapping(uint256 => EncryptedInteraction) public encryptedInteractions;
    mapping(uint256 => DecryptedInteraction) public decryptedInteractions;
    LightPattern public currentPattern;

    mapping(uint256 => uint256) private requestToInteractionId;
    
    event InteractionSubmitted(uint256 indexed visitorId, uint256 timestamp);
    event PatternUpdated(uint256 timestamp);
    event InteractionDecrypted(uint256 indexed visitorId);

    function registerVisitor() public returns (uint256) {
        visitorCount += 1;
        return visitorCount;
    }

    function submitEncryptedInteraction(
        euint32 encryptedPositionX,
        euint32 encryptedPositionY,
        euint32 encryptedIntensity,
        euint32 encryptedDuration
    ) public {
        uint256 visitorId = getVisitorId(msg.sender);
        
        encryptedInteractions[visitorId] = EncryptedInteraction({
            visitorId: visitorId,
            encryptedPositionX: encryptedPositionX,
            encryptedPositionY: encryptedPositionY,
            encryptedIntensity: encryptedIntensity,
            encryptedDuration: encryptedDuration,
            timestamp: block.timestamp
        });

        decryptedInteractions[visitorId] = DecryptedInteraction({
            positionX: 0,
            positionY: 0,
            intensity: 0,
            duration: 0,
            isRevealed: false
        });

        updateLightPattern(visitorId);
        emit InteractionSubmitted(visitorId, block.timestamp);
    }

    function updateLightPattern(uint256 visitorId) private {
        EncryptedInteraction storage interaction = encryptedInteractions[visitorId];
        
        if (!FHE.isInitialized(currentPattern.patternIntensity)) {
            currentPattern.patternIntensity = FHE.asEuint32(0);
            currentPattern.patternFrequency = FHE.asEuint32(0);
            currentPattern.patternDuration = FHE.asEuint32(0);
        }

        currentPattern.patternIntensity = FHE.add(
            currentPattern.patternIntensity,
            interaction.encryptedIntensity
        );
        
        currentPattern.patternFrequency = FHE.add(
            currentPattern.patternFrequency,
            FHE.div(interaction.encryptedPositionX, interaction.encryptedPositionY)
        );
        
        currentPattern.patternDuration = FHE.add(
            currentPattern.patternDuration,
            interaction.encryptedDuration
        );

        emit PatternUpdated(block.timestamp);
    }

    function requestInteractionDecryption(uint256 visitorId) public {
        require(msg.sender == getVisitorAddress(visitorId), "Not visitor");
        require(!decryptedInteractions[visitorId].isRevealed, "Already decrypted");

        EncryptedInteraction storage interaction = encryptedInteractions[visitorId];
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(interaction.encryptedPositionX);
        ciphertexts[1] = FHE.toBytes32(interaction.encryptedPositionY);
        ciphertexts[2] = FHE.toBytes32(interaction.encryptedIntensity);
        ciphertexts[3] = FHE.toBytes32(interaction.encryptedDuration);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptInteraction.selector);
        requestToInteractionId[reqId] = visitorId;
    }

    function decryptInteraction(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 visitorId = requestToInteractionId[requestId];
        require(visitorId != 0, "Invalid request");

        DecryptedInteraction storage dInteraction = decryptedInteractions[visitorId];
        require(!dInteraction.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint32 posX, uint32 posY, uint32 intensity, uint32 duration) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32));
        
        dInteraction.positionX = posX;
        dInteraction.positionY = posY;
        dInteraction.intensity = intensity;
        dInteraction.duration = duration;
        dInteraction.isRevealed = true;

        emit InteractionDecrypted(visitorId);
    }

    function requestPatternDecryption() public {
        require(FHE.isInitialized(currentPattern.patternIntensity), "Pattern not initialized");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(currentPattern.patternIntensity);
        ciphertexts[1] = FHE.toBytes32(currentPattern.patternFrequency);
        ciphertexts[2] = FHE.toBytes32(currentPattern.patternDuration);
        
        FHE.requestDecryption(ciphertexts, this.decryptPattern.selector);
    }

    function decryptPattern(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        FHE.checkSignatures(requestId, cleartexts, proof);
        (uint32 intensity, uint32 frequency, uint32 duration) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
        // Process decrypted pattern as needed
    }

    mapping(address => uint256) private addressToVisitorId;
    mapping(uint256 => address) private visitorIdToAddress;

    function getVisitorId(address visitorAddress) private returns (uint256) {
        if (addressToVisitorId[visitorAddress] == 0) {
            uint256 newId = registerVisitor();
            addressToVisitorId[visitorAddress] = newId;
            visitorIdToAddress[newId] = visitorAddress;
            return newId;
        }
        return addressToVisitorId[visitorAddress];
    }

    function getVisitorAddress(uint256 visitorId) private view returns (address) {
        return visitorIdToAddress[visitorId];
    }
}