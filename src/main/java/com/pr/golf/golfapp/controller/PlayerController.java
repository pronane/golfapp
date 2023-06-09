package com.pr.golf.golfapp.controller;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import com.pr.golf.golfapp.dto.AddPlayerDTO;
import com.pr.golf.golfapp.dto.PlayerDTO;
import com.pr.golf.golfapp.model.Player;
import com.pr.golf.golfapp.service.PlayerService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@RequestMapping("/players")
public class PlayerController {

    private final static AtomicLong subIdCounter = new AtomicLong(System.nanoTime());

    private PlayerService playerService;
    
    public PlayerController(@Autowired PlayerService playerService) {
    	this.playerService = playerService;
    }

    @RequestMapping(
            method = RequestMethod.POST,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity createPlayer(@RequestBody List<AddPlayerDTO> playersToAdd) throws URISyntaxException {
    	log.info("Adding players for " + playersToAdd);
    	List<Player> players = playersToAdd.stream()
    	    .map(addPlayerDTO -> {
    	        // Perform necessary transformations from AddPlayerDTO to Player
    	        // Create a new Player object based on the AddPlayerDTO attributes
    	        // Return the new Player object
    	        return Player.builder().name(addPlayerDTO.getFirstName() + " " + addPlayerDTO.getLastName())
    	        						.handicap(addPlayerDTO.getHandicap())
    	        						.build();
    	    })
    	    .collect(Collectors.toList());

        List<Player> savedPlayer = playerService.saveAll(players);
        return ResponseEntity.created(new URI("/players/" + 1l)).body(savedPlayer);
    }

    @PutMapping("/{id}")
    public ResponseEntity<List<Player>> updatePlayers(@PathVariable Long id, @RequestBody List<Player> players) {
        Player currentPlayer = playerService.findById(id).orElseThrow(RuntimeException::new);
        List<Player> updatedPlayers = playerService.update(players);

        return ResponseEntity.ok(updatedPlayers);
    }
    @GetMapping("/{id}")
    public Player getPlayer(@PathVariable Long id) {
        return playerService.findById(id).orElseThrow(RuntimeException::new);
    }

    @RequestMapping(value = "/eventId/{eventId}",
            method = RequestMethod.GET,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public Collection<Player> getPlayersForEvent(@PathVariable Long eventId) {
        return playerService.findPlayersByEventId(eventId).orElseThrow(RuntimeException::new);
    }

    @RequestMapping(value = "/getallplayers",
            method = RequestMethod.GET,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public Collection<PlayerDTO> getAllPlayers() {
        return playerService.getAllPlayers().orElseThrow(RuntimeException::new);
    }
}
