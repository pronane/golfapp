package com.pr.golf.golfapp.response;

import java.util.List;

import com.pr.golf.golfapp.dto.BonusPointRule;
import com.pr.golf.golfapp.dto.CompetitionDTO;
import com.pr.golf.golfapp.dto.GolfEventDTO;
import com.pr.golf.golfapp.dto.HoleDTO;
import com.pr.golf.golfapp.dto.PlayerDTO;
import com.pr.golf.golfapp.dto.ScoreDTO;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Builder
@Setter
@EqualsAndHashCode
@ToString
public class ScoreCardResponseBody {
	
	private long scoreCardId;
	
	private CompetitionDTO competition;
	
	private GolfEventDTO golfEventDTO;
	
	private List<HoleDTO> holes;
	
	private List<PlayerDTO> players;
	
	private List<ScoreDTO> scoreDTOs;
	
	private List<BonusPointRule> bonusPointRules;
	
	 private int groupNumber;
}
