package com.pr.golf.golfapp.helper;

import java.util.List;

import org.assertj.core.api.MatcherAssert;
import org.assertj.core.util.Arrays;
import org.hamcrest.collection.HasItemInArray;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.util.UriComponents;
import org.springframework.web.util.UriComponentsBuilder;

import com.pr.golf.golfapp.controller.PlayerController;
import com.pr.golf.golfapp.model.Player;

public class PlayerHelper {
	
	
	public static List<Player> addPlayers(List<Player> playerList, PlayerController playerController, int port) {
	     UriComponents uri = UriComponentsBuilder.newInstance()
                   .port(port)
                   .host("127.0.0.1").port(port).build();
	     
		 @SuppressWarnings("unchecked")
		List<Player> players =  (List<Player>) WebTestClient
	                .bindToController(playerController)
	                .build()
	                .post()
	                .uri(uri.toString()+"/players")
	                .bodyValue(playerList)
	                .exchange()
	                .expectStatus().isCreated()
	                .expectHeader().valueEquals("Content-Type", "application/json")
	                .expectAll(jsonBodySpec -> {
	                   // jsonBodySpec.expectBody().jsonPath("id").isEqualTo(1l);
	                }, responseSpec -> {
	                    responseSpec.expectBodyList(Player.class)
	                    .consumeWith(result -> {
	                        List<Player> responseBody = result.getResponseBody();
	                        System.out.println(responseBody);
	                      });
	                    
	                }).expectBodyList(Player.class).returnResult().getResponseBody();
		 
		 return players;
		
	}

}
