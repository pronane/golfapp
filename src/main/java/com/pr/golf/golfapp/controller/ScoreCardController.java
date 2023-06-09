package com.pr.golf.golfapp.controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pr.golf.golfapp.dto.BonusPointRule;
import com.pr.golf.golfapp.dto.CompetitionDTO;
import com.pr.golf.golfapp.dto.GolfEventDTO;
import com.pr.golf.golfapp.dto.HoleDTO;
import com.pr.golf.golfapp.dto.PlayerDTO;
import com.pr.golf.golfapp.dto.ScoreCardDTO;
import com.pr.golf.golfapp.dto.ScoreDTO;
import com.pr.golf.golfapp.mapper.CompetitionMapper;
import com.pr.golf.golfapp.mapper.PlayerMapper;
import com.pr.golf.golfapp.mapper.ScoreMapper;
import com.pr.golf.golfapp.model.GolfCourse;
import com.pr.golf.golfapp.model.Player;
import com.pr.golf.golfapp.model.PlayerGrouping;
import com.pr.golf.golfapp.model.Score;
import com.pr.golf.golfapp.response.ScoreCardResponseBody;
import com.pr.golf.golfapp.service.GolfCourseService;
import com.pr.golf.golfapp.service.GolfEventService;
import com.pr.golf.golfapp.service.PlayerService;
import com.pr.golf.golfapp.service.ScoreService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@RequestMapping("/scorecard")
public class ScoreCardController {

	private final static AtomicLong subIdCounter = new AtomicLong(System.nanoTime());

	private ScoreService scoreService;

	private GolfEventService golfEventService;

	private GolfCourseService golfCourseService;

	private ScoreMapper scoreMapper;

	private PlayerMapper playerMapper;

	private CompetitionMapper competitionMapper;

	private PlayerService playerService;

	public ScoreCardController(@Autowired ScoreService scoreService, @Autowired PlayerService playerService,
			@Autowired GolfCourseService golfCourseService, @Autowired ScoreMapper scoreMapper,
			@Autowired GolfEventService golfEventService, @Autowired PlayerMapper playerMapper,
			@Autowired CompetitionMapper competitionMapper) {
		this.scoreService = scoreService;
		this.playerService = playerService;
		this.golfCourseService = golfCourseService;
		this.scoreMapper = scoreMapper;
		this.golfEventService = golfEventService;
		this.playerMapper = playerMapper;
		this.competitionMapper = competitionMapper;
	}

	@GetMapping("/retrievescorecards")
	public List<ScoreCardDTO> getScoreCards(@RequestParam(required = false) Long eventId,
	        @RequestParam(required = false) String eventName,
	        @RequestParam(required = false) Long groupingId,
	        @RequestParam(required = false) String groupingTitle) {
	    // Determine the search criteria based on the provided parameters
	    String searchCriteria = null;
	    String searchText = null;
	    if (eventId != null) {
	        searchCriteria = "eventId";
	        searchText = eventId.toString();
	    } else if (eventName != null) {
	        searchCriteria = "eventName";
	        searchText = eventName;
	    } else if (groupingTitle != null) {
	        searchCriteria = "groupingTitle";
	        searchText = groupingTitle;
	    }
	  
	    // Call the service method with the updated search criteria
		//List<PlayerGrouping> groupings = golfEventService.getPlayerGroupsForEvent(eventId);
	    List<PlayerGrouping> groupings = golfEventService.getPlayerGroupingsBySearchCriteria(searchCriteria, searchText);
	    //List<PlayerGrouping> playerGroupings = scoreCardService.getPlayerGroupingsBySearchCriteria(searchCriteria, searchText);


		List<ScoreCardDTO> scoreCards = new ArrayList<>();
		Map<Integer, ScoreCardDTO> scoreCardMap = new HashMap(); // Map to store ScoreCardDTO by group number



		for (PlayerGrouping grouping : groupings) {
			int groupNumber = grouping.getGroupNumber();

			// Retrieve or create ScoreCardDTO for the group number
			ScoreCardDTO scoreCardDTO = scoreCardMap.get(groupNumber);
			if (scoreCardDTO == null) {
				scoreCardDTO = ScoreCardDTO.builder().id(grouping.getGroupingId()).eventId(grouping.getEvent().getId())
						.groupNumber(String.valueOf(groupNumber)).players(new ArrayList<>()).build();

				scoreCardMap.put(groupNumber, scoreCardDTO);
			}
			Player player = grouping.getPlayer();
			PlayerDTO playerDto = playerMapper.toDto(player);
			scoreCardDTO.getPlayers().add(playerDto);
		}
		scoreCards.addAll(scoreCardMap.values());
		return scoreCards;
	}

	@GetMapping("/{eventId}/{groupNumber}")
	public ResponseEntity<ScoreCardResponseBody> getScoreCard(@PathVariable Long eventId,
			@PathVariable int groupNumber) {
		log.info("Got here in ScoreCardControler");
		/*
		 * List<Player> players = List.of(Player.builder().id(1l)
		 * .name("Darragh Flynn").handicap(28).build(), Player.builder().id(2l)
		 * .name("Paul Ronane").handicap(21).build());
		 */

		// Optional<List<Player>> players = playerService.findPlayersByEventId(id);

		List<PlayerGrouping> playersInGroup = golfEventService.getPlayersGroupByEventAndGroupNumber(eventId,
				groupNumber);

		/**
		 * List<Hole> holes = List.of(Hole.builder() .white(560) .yellow(549) .id(1l)
		 * .holeNumber(1) .name("Everest") .stroke(7) .par(5) .build(), Hole.builder()
		 * .white(325) .yellow(312) .id(2l) .holeNumber(2) .name("Long wash")
		 * .stroke(15) .par(4) .build());
		 **/
		GolfCourse golfCourse = golfCourseService.getGolfCourseByName("Essendon");
		List<HoleDTO> holeDtos = golfCourse.getHoles().stream()
				.map(hole -> HoleDTO.builder().id(hole.getId()).courseId(golfCourse.getId())
						.holeNumber(hole.getHoleNumber()).par(hole.getPar()).stroke(hole.getStroke())
						.white(hole.getWhite()).yellow(hole.getYellow()).red(hole.getRed())
						// set other fields as necessary
						.build())
				.collect(Collectors.toList());

		Optional<GolfEventDTO> golfEvent = golfEventService.getGolfEventById(eventId);

		Optional<List<Score>> scores = scoreService.findScoresByEventId(eventId);

		List<ScoreDTO> scoreDtos = scoreMapper.toDto(scores.get());

		CompetitionDTO competitionDTO = golfEvent.get().getCompetition();

		List<PlayerDTO> playerDtos = playerMapper.toDto(playersInGroup.stream().map(PlayerGrouping::getPlayer)
				.collect(Collectors.toList()));

		ScoreCardResponseBody scoreCardResponseBody = ScoreCardResponseBody.builder().holes(holeDtos)
				.players(playerDtos).golfEventDTO(golfEvent.get()).scoreDTOs(scoreDtos).competition(competitionDTO)
				.bonusPointRules(List.of(
						BonusPointRule.builder().comeptitionId(competitionDTO.getId()).name("Closest to the pin")
								.points(5).holeNumber(7).build(),
						BonusPointRule.builder().comeptitionId(competitionDTO.getId()).name("Longest Drive").points(5)
								.holeNumber(17).build()))
				.build();

		scoreCardResponseBody.getScoreDTOs().stream().forEach(score -> {
			System.out.print(" " + score.getPoints());
		});
		System.out.print(scoreCardResponseBody.toString());
		return ResponseEntity.ok(scoreCardResponseBody);
	}
}
